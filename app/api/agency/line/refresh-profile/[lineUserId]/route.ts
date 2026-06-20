import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getUserProfile } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/refresh-profile/[lineUserId]
 *
 * LINE API で 指定 友達 の プロフィール (display_name / picture_url) を 再取得 し、
 * line_user_links を 更新 する。
 *
 * 連携前 友達 / バックフィル ダミー の リカバリ 用。
 */
type RouteContext = { params: Promise<{ lineUserId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  const profile = await getUserProfile(channel.channelAccessToken, lineUserId);
  if (!profile.ok) {
    return NextResponse.json(
      {
        error: "profile_fetch_failed",
        message: profile.message,
        status: profile.status,
      },
      { status: 502 },
    );
  }

  const { error } = await admin
    .from("line_user_links")
    .update({
      display_name: profile.data.displayName,
      picture_url: profile.data.pictureUrl,
      status_message: profile.data.statusMessage,
    })
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profile: {
      displayName: profile.data.displayName,
      pictureUrl: profile.data.pictureUrl,
    },
  });
}

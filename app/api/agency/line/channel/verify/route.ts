import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getBotInfo } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/channel/verify
 *
 * 保存済 Channel Access Token の 有効性 を 再検証 する。
 * Token が ローテーション された / 失効した 場合 に UI から 押せる ボタン用。
 *
 * 失敗時 は last_verified_at を 更新せず エラー を 返す (運用 で 気づける ように)。
 */
export async function POST() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 404 });
  }

  const result = await getBotInfo(channel.channelAccessToken);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "verify_failed",
        message: result.message,
        status: result.status,
      },
      { status: 400 },
    );
  }

  // 検証 OK → last_verified_at + bot 情報 を 更新
  await admin
    .from("line_channels")
    .update({
      line_bot_user_id: result.data.userId,
      last_verified_at: new Date().toISOString(),
    })
    .eq("organization_id", guard.organization.id);

  return NextResponse.json({
    ok: true,
    botInfo: {
      displayName: result.data.displayName,
      basicId: result.data.basicId,
      pictureUrl: result.data.pictureUrl,
      chatMode: result.data.chatMode,
    },
  });
}

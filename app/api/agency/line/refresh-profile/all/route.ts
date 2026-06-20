import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { getUserProfile } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/refresh-profile/all
 *
 * 「プロフィール 未取得 / プレースホルダ」 の 友達 を 全部 LINE API で 取り直す。
 * admin 限定。 ブロック / 友達解除 された ユーザー は スキップ (API が 失敗 するため)。
 *
 * 並列度:5 (LINE API レート制限 を 避ける)
 */
const CONCURRENCY = 5;
const PLACEHOLDERS = new Set(["(連携前 友達)", "(連携前友達)", "(名前なし)"]);

export async function POST() {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  const { data } = await admin
    .from("line_user_links")
    .select("line_user_id, display_name")
    .eq("organization_id", guard.organization.id)
    .is("unfollowed_at", null);

  type Row = { line_user_id: string; display_name: string | null };
  const rows = ((data ?? []) as Row[]).filter(
    (r) => r.display_name === null || PLACEHOLDERS.has(r.display_name),
  );

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  // 並列 (CONCURRENCY 個 ずつ)
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (r) => {
        try {
          const p = await getUserProfile(channel.channelAccessToken, r.line_user_id);
          if (!p.ok) {
            return { ok: false, lineUserId: r.line_user_id, err: p.message };
          }
          const { error } = await admin
            .from("line_user_links")
            .update({
              display_name: p.data.displayName,
              picture_url: p.data.pictureUrl,
              status_message: p.data.statusMessage,
            })
            .eq("organization_id", guard.organization.id)
            .eq("line_user_id", r.line_user_id);
          if (error) {
            return { ok: false, lineUserId: r.line_user_id, err: error.message };
          }
          return { ok: true, lineUserId: r.line_user_id };
        } catch (e) {
          return {
            ok: false,
            lineUserId: r.line_user_id,
            err: e instanceof Error ? e.message : "unknown",
          };
        }
      }),
    );
    for (const r of results) {
      if (r.ok) updated += 1;
      else {
        failed += 1;
        errors.push(`${r.lineUserId.slice(0, 12)}...: ${r.err}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    target: rows.length,
    updated,
    failed,
    errors: errors.slice(0, 10),
  });
}

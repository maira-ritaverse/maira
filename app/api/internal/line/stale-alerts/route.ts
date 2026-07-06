import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { fireSeekerNotification } from "@/lib/notifications/in-app";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/internal/line/stale-alerts
 *
 * 30 分 毎 に 走る cron。 LINE 会話 で 3 日 以上 連絡 なし の 顧客 を 検出 して
 * 担当者 (assigned_to_user_id) に in-app 通知 を 送る。
 *
 * 抽出 条件 (すべて 満たす):
 *   ・handled_at IS NULL           (対応 済 で ない)
 *   ・unfollowed_at IS NULL        (ブロック / 友達 解除 で ない)
 *   ・assigned_to_user_id IS NOT NULL (担当者 が 決まって いる)
 *   ・last_activity_at < now() - '3 days'
 *   ・(stale_alerted_at IS NULL OR stale_alerted_at < now() - '24 hours')
 *
 * 発火 後 の 挙動:
 *   ・stale_alerted_at = now() で 24 時間 のクール ダウン
 *   ・顧客 が 返信 → line_messages トリガー で last_activity_at 更新
 *     → 抽出 条件 を 満たさ なく なる → 通知 は 止まる
 */
export const dynamic = "force-dynamic";

const RESULT_LIMIT = 200;
const STALE_DAYS = 3;
const COOLDOWN_HOURS = 24;

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json(
        { error: "CRON_SECRET / INTAKE_CRON_SECRET 未設定" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const cooldownThreshold = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("line_user_links")
    .select(
      "id, organization_id, line_user_id, display_name, custom_name, client_record_id, assigned_to_user_id, last_activity_at, stale_alerted_at",
    )
    .is("handled_at", null)
    .is("unfollowed_at", null)
    .not("assigned_to_user_id", "is", null)
    .lt("last_activity_at", staleThreshold)
    .or(`stale_alerted_at.is.null,stale_alerted_at.lt.${cooldownThreshold}`)
    .limit(RESULT_LIMIT);

  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    organization_id: string;
    line_user_id: string;
    display_name: string | null;
    custom_name: string | null;
    client_record_id: string | null;
    assigned_to_user_id: string;
    last_activity_at: string;
    stale_alerted_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  let sent = 0;
  const errors: string[] = [];

  // クライアント 名 の 取得 は 個別 に 引く (件数 が 少ない 想定 の た め batch なし)。
  // 大きく なった ら client_record_id で group 化 して 1 クエリ に。
  for (const row of rows) {
    let clientName: string | null = null;
    if (row.client_record_id) {
      const { data: clientRow } = await admin
        .from("client_records")
        .select("name")
        .eq("id", row.client_record_id)
        .maybeSingle();
      clientName = (clientRow as { name: string | null } | null)?.name ?? null;
    }

    const displayName = row.custom_name ?? row.display_name;
    const daysSince = Math.floor(
      (now.getTime() - new Date(row.last_activity_at).getTime()) / (1000 * 60 * 60 * 24),
    );

    const title = clientName ?? displayName ?? "(名前なし)";
    try {
      await fireSeekerNotification({
        userId: row.assigned_to_user_id,
        payload: {
          kind: "line_stale_alert",
          title: `${title} さんと ${daysSince} 日 連絡 なし`,
          href: `/agency/line/${encodeURIComponent(row.line_user_id)}`,
          lineUserId: row.line_user_id,
          displayName,
          clientRecordId: row.client_record_id,
          clientName,
          daysSinceLastActivity: daysSince,
        },
      });
      // クール ダウン セット
      await admin
        .from("line_user_links")
        .update({ stale_alerted_at: now.toISOString() })
        .eq("id", row.id);
      sent += 1;
    } catch (e) {
      errors.push(`${row.line_user_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    sent,
    errors: errors.slice(0, 20),
  });
}

export const GET = POST;

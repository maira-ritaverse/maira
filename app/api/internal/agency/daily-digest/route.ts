import { NextResponse } from "next/server";

import {
  computeDailyDigestForAdmin,
  digestHasContent,
  type DailyDigestSummary,
} from "@/lib/agency/daily-digest";
import { checkCronAuth } from "@/lib/api/cron-auth";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { sendDailyDigestEmail } from "@/lib/email/agency-daily-digest";
import { isEmailEnabled, isSubscribed, type NotificationPrefs } from "@/lib/notifications/prefs";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET/POST /api/internal/agency/daily-digest
 *
 * Vercel Cron から 毎朝 JST 8:00 (UTC 23:00) に 起動。
 * 全 organization の admin に つき、 通知 prefs を 尊重 して Daily ダイジェスト
 * メール を 配信 する (= プロアクティブ 伴走 Phase A1)。
 *
 * 配信 条件 (AND):
 *   1. organization_members.role = 'admin'
 *   2. notification_prefs.email_enabled !== false
 *   3. notification_prefs.daily_digest !== false
 *   4. 集計 結果 が 何 か しら 0 でない (全 0 なら 「平和な 朝」 と して skip)
 *
 * 認証 は CRON_SECRET / INTAKE_CRON_SECRET。 Vercel Cron は CRON_SECRET 自動 付与。
 */
export const dynamic = "force-dynamic";
// Resend へ の 並列 送信 + DB 集計 で 数秒 〜 数十秒 かかる 可能性 が ある ため
// maxDuration を 明示。
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json({ error: "CRON_SECRET 未設定" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const nowIso = new Date().toISOString();

  // admin 全員 + 所属 組織 名 を 取得
  // organization_members には notification_prefs / organization_id / member.id が ある。
  // 1 クエリ で 必要 情報 を 引いて 各 admin を 並列 処理 する。
  const { data: members } = await service
    .from("organization_members")
    .select("id, user_id, organization_id, notification_prefs, organizations(name, archived_at)")
    .eq("role", "admin");

  type Row = {
    id: string;
    user_id: string;
    organization_id: string;
    notification_prefs: NotificationPrefs | null;
    organizations:
      | { name: string; archived_at: string | null }
      | { name: string; archived_at: string | null }[]
      | null;
  };
  const rows = ((members ?? []) as Row[]).filter((m) => {
    const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
    if (!org) return false;
    if (org.archived_at) return false;
    if (!isEmailEnabled(m.notification_prefs)) return false;
    if (!isSubscribed(m.notification_prefs, "daily_digest")) return false;
    return true;
  });

  // 集計 + 送信 を 並列 (service-role 同一 接続 で 多重化 さ れる ため 数十 件 まで 安全)
  const todayLabel = formatJstDate(new Date(nowIso));
  const dashboardUrl = buildAbsoluteUrl("/agency");

  const results = await Promise.all(
    rows.map(async (m) => {
      const summary = await computeDailyDigestForAdmin({
        service,
        organizationId: m.organization_id,
        memberId: m.id,
        nowIso,
      });
      if (!digestHasContent(summary)) {
        return { userId: m.user_id, skipped: true as const, reason: "no_content" };
      }
      const orgName =
        (Array.isArray(m.organizations) ? m.organizations[0]?.name : m.organizations?.name) ??
        "(エージェント企業)";

      // メール アドレス は auth.users から 引く (1 件 ずつ。 並列 数 が 多く なる
      // 場合 は 別途 まとめ取り 検討)
      const userLookup = await service.auth.admin.getUserById(m.user_id);
      const email = userLookup.data?.user?.email ?? null;
      if (!email) return { userId: m.user_id, skipped: true as const, reason: "no_email" };

      // 表示 名 取得 (失敗 して も skip しない、 email 宛 で 出す)
      const { data: profile } = await service
        .from("profiles")
        .select("display_name")
        .eq("id", m.user_id)
        .maybeSingle();
      const displayName = (profile as { display_name: string | null } | null)?.display_name ?? null;

      const sendResult = await sendDailyDigestEmail({
        toEmail: email,
        organizationName: orgName,
        memberDisplayName: displayName,
        summary,
        dashboardUrl,
        todayLabel,
      });
      return { userId: m.user_id, skipped: false as const, sendResult, summary };
    }),
  );

  const sentCount = results.filter((r) => !r.skipped && r.sendResult.sent).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  const failedCount = results.filter((r) => !r.skipped && !r.sendResult.sent).length;

  return NextResponse.json({
    ok: true,
    candidates: rows.length,
    sent: sentCount,
    skipped: skippedCount,
    failed: failedCount,
  });
}

export const GET = POST;

/** JST 日付 ラベル: 「2026/06/30 (月)」 */
function formatJstDate(utcDate: Date): string {
  const jst = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const wd = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
  return `${y}/${m}/${d} (${wd})`;
}

// 型 注釈 (linter 用 — 戻り値 型 の 説明 だけ で 実行 時 影響 なし)
void (null as DailyDigestSummary | null);

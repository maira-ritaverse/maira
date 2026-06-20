/**
 * LINE MA の KPI 集計 (組織 単位)。
 *
 * 表示 する 指標:
 *   sentCount        今月 の LINE 配信 数 (ma_send_logs.status='sent' か つ
 *                   recipient_line_user_id IS NOT NULL)
 *   clickCount       クリック 数 (現状 未計測 → null。 将来 トラッキング URL で 実装)
 *   replyCount       今月 の LINE inbound 件数 (line_messages.direction='inbound')
 *                   ※ MA 配信 起因 か どうか は attribution 出来 ない の で 全 件
 *   applicationCount 今月 の 応募 件数 (referrals + agency_applications の 合算)
 *                   ※ LINE MA 由来 attribution 未実装 → 参考 値
 *   limit            LINE 公式 アカウント の 月次 配信 上限 (LINE 標準 5000、
 *                   Lite=200 等 プラン 依存。 現状 5000 固定 で 表示)
 */
import { createClient } from "@/lib/supabase/server";

const DEFAULT_LINE_MONTHLY_LIMIT = 5000;

export type LineMaKpi = {
  sentCount: number;
  /** ma_click_links の click_count を 月 単位 で 合算。 値 0 と null は 別 概念 */
  clickCount: number;
  replyCount: number;
  /** LINE MA 配信 後 7 日 以内 に referrals 作成 された 一意 client 数 */
  applicationCount: number;
  limit: number;
  /** 集計 対象 期間 の 月 (YYYY-MM)、 UI 表示 用 */
  periodLabel: string;
};

export type KpiPeriod = "current" | "prev";

export async function getLineMaKpi(
  organizationId: string,
  period: KpiPeriod = "current",
): Promise<LineMaKpi> {
  const supabase = await createClient();

  // 期間 切り出し。 月 単位 で 「今月」 か 「先月」 を 選ぶ。
  const now = new Date();
  const offset = period === "prev" ? -1 : 0;
  const targetYear = now.getFullYear();
  const targetMonth = now.getMonth() + offset;
  const start = new Date(targetYear, targetMonth, 1).toISOString();
  const end = new Date(targetYear, targetMonth + 1, 1).toISOString();
  const labelDate = new Date(targetYear, targetMonth, 1);
  const periodLabel = `${labelDate.getFullYear()}-${String(labelDate.getMonth() + 1).padStart(2, "0")}`;

  type CountResult = { count: number | null };

  const [sentRes, replyRes, clickAggRes, sentLogsForAttr] = await Promise.all([
    supabase
      .from("ma_send_logs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "sent")
      .not("recipient_line_user_id", "is", null)
      .gte("sent_at", start)
      .lt("sent_at", end)
      .then((r) => (r as unknown as CountResult).count ?? 0),
    supabase
      .from("line_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("direction", "inbound")
      .gte("created_at", start)
      .lt("created_at", end)
      .then((r) => (r as unknown as CountResult).count ?? 0),
    // クリック 集計: 今月 作成 された ma_click_links の click_count を 合計
    supabase
      .from("ma_click_links")
      .select("click_count")
      .eq("organization_id", organizationId)
      .gte("created_at", start)
      .lt("created_at", end),
    // 応募 attribution 用: 今月 配信 した client_record_id と sent_at を 取得
    supabase
      .from("ma_send_logs")
      .select("recipient_client_record_id, sent_at")
      .eq("organization_id", organizationId)
      .eq("status", "sent")
      .not("recipient_line_user_id", "is", null)
      .not("recipient_client_record_id", "is", null)
      .gte("sent_at", start)
      .lt("sent_at", end),
  ]);

  type ClickRow = { click_count: number };
  const clickCount = ((clickAggRes.data ?? []) as ClickRow[]).reduce(
    (sum, r) => sum + (r.click_count ?? 0),
    0,
  );

  // 応募 attribution: 配信 後 ATTRIBUTION_WINDOW_DAYS 日 以内 に referrals が
  // 作られた client_record_id の 一意 数 を カウント。
  type SentLogRow = { recipient_client_record_id: string | null; sent_at: string };
  const sentLogs = (sentLogsForAttr.data ?? []) as SentLogRow[];
  const applicationCount = await computeAttributedApplications(supabase, organizationId, sentLogs);

  return {
    sentCount: sentRes,
    clickCount,
    replyCount: replyRes,
    applicationCount,
    limit: DEFAULT_LINE_MONTHLY_LIMIT,
    periodLabel,
  };
}

// 配信 後 何 日 以内 の 応募 を MA 起因 と 見なす か
const ATTRIBUTION_WINDOW_DAYS = 7;

async function computeAttributedApplications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  sentLogs: Array<{ recipient_client_record_id: string | null; sent_at: string }>,
): Promise<number> {
  if (sentLogs.length === 0) return 0;

  // 各 client の **最古** の sent_at を 採用 (= 一番 早く 配信 した タイミング
  // から window を 取る ほう が attribution に 寛容)
  const clientToEarliestSentAt = new Map<string, Date>();
  for (const log of sentLogs) {
    const cid = log.recipient_client_record_id;
    if (!cid) continue;
    const t = new Date(log.sent_at);
    const cur = clientToEarliestSentAt.get(cid);
    if (!cur || t < cur) clientToEarliestSentAt.set(cid, t);
  }
  const clientIds = Array.from(clientToEarliestSentAt.keys());
  if (clientIds.length === 0) return 0;

  // 該当 client の referrals を 一括 取得
  const { data: refsData } = await supabase
    .from("referrals")
    .select("client_record_id, created_at")
    .eq("organization_id", organizationId)
    .in("client_record_id", clientIds);
  type RefRow = { client_record_id: string; created_at: string };
  const refs = (refsData ?? []) as RefRow[];

  const windowMs = ATTRIBUTION_WINDOW_DAYS * 86400 * 1000;
  const attributed = new Set<string>();
  for (const r of refs) {
    const sentAt = clientToEarliestSentAt.get(r.client_record_id);
    if (!sentAt) continue;
    const refAt = new Date(r.created_at);
    if (refAt >= sentAt && refAt.getTime() <= sentAt.getTime() + windowMs) {
      attributed.add(r.client_record_id);
    }
  }
  return attributed.size;
}

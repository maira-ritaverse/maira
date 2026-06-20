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
  /** LINE MA 由来 attribution 未実装 の ため 参考 値 (準備中)。 */
  applicationCount: number | null;
  limit: number;
  /** 集計 対象 期間 の 月 (YYYY-MM)、 UI 表示 用 */
  periodLabel: string;
};

export async function getLineMaKpi(organizationId: string): Promise<LineMaKpi> {
  const supabase = await createClient();

  // 今月 の 開始 / 終了 を ISO で 計算 (UTC で 切り出し、 日本 時刻 と は ±9h ずれる が
  // 月次 KPI の 集計 用 と して は 実用上 問題 ない)。
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  type CountResult = { count: number | null };

  const [sentRes, replyRes, clickAggRes] = await Promise.all([
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
  ]);

  type ClickRow = { click_count: number };
  const clickCount = ((clickAggRes.data ?? []) as ClickRow[]).reduce(
    (sum, r) => sum + (r.click_count ?? 0),
    0,
  );

  return {
    sentCount: sentRes,
    clickCount,
    replyCount: replyRes,
    applicationCount: null, // attribution 未実装 (Phase B で 実装)
    limit: DEFAULT_LINE_MONTHLY_LIMIT,
    periodLabel,
  };
}

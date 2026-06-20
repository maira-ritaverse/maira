/**
 * エージェント ダッシュボード の 「今月 の 活動」 KPI 集計。
 *
 * 全 指標 は organization 単位 + 今月 (1 日 00:00 〜 翌月 1 日 00:00) で 集計。
 * count: "exact", head: true で 件数 だけ 取得 (本体 行 は ロード しない)。
 */
import { createClient } from "@/lib/supabase/server";

export type MonthlyActivityKpi = {
  /** 今月 新規 登録 された 顧客 */
  newClients: number;
  /** 今月 新規 作成 された 推薦 (referrals) */
  newReferrals: number;
  /** 今月 実施 された 面接 (interviews.result='done') */
  doneInterviews: number;
  /** 今月 内定 / 入社 が 確定 した referrals 数 (status in offer / joined) */
  offersJoined: number;
  /** 今月 の MA 配信 数 (Email + LINE 合算、 status='sent') */
  maSent: number;
  /** 今月 の LINE 受信 数 (友達 → 自社) */
  lineInbound: number;
  /** 集計 対象 月 (YYYY-MM、 UI 表示 用) */
  periodLabel: string;
};

export async function getMonthlyActivityKpi(organizationId: string): Promise<MonthlyActivityKpi> {
  const supabase = await createClient();

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  type CountResult = { count: number | null };

  const [newClients, newReferrals, doneInterviews, offersJoined, maSent, lineInbound] =
    await Promise.all([
      supabase
        .from("client_records")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", start)
        .lt("created_at", end)
        .then((r) => (r as unknown as CountResult).count ?? 0),
      supabase
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", start)
        .lt("created_at", end)
        .then((r) => (r as unknown as CountResult).count ?? 0),
      supabase
        .from("interviews")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("result", "done")
        .gte("scheduled_at", start)
        .lt("scheduled_at", end)
        .then((r) => (r as unknown as CountResult).count ?? 0),
      supabase
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .in("status", ["offer", "joined"])
        .gte("updated_at", start)
        .lt("updated_at", end)
        .then((r) => (r as unknown as CountResult).count ?? 0),
      supabase
        .from("ma_send_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "sent")
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
    ]);

  return {
    newClients,
    newReferrals,
    doneInterviews,
    offersJoined,
    maSent,
    lineInbound,
    periodLabel,
  };
}

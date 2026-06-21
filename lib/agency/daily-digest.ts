/**
 * 朝 の Daily ダイジェスト 集計 (Phase A1: プロアクティブ 伴走)
 *
 * 対象: 各 organization の admin。 集計 は service_role で 直接 SQL。
 *
 * 集計 内容:
 *   - 自分 宛 で 「今日 期限」 と 「期限 超過」 の pending タスク 件数
 *   - 組織 全体 で 30 日 以上 沈黙 (last_interaction_at が 30 日 以上 前) の
 *     対応 中 顧客 数 (status 完了 / 見送り は 除外)
 *   - 組織 全体 で 7 日 以上 status 変化 が ない 「対応 中 (introduced / interviewing)」
 *     な 応募 (referrals) 件数
 *
 * ノイズ メール を 避ける ため、 全 件数 が 0 の 時 は 「送信 すべきでは ない」 と
 * 判定 し、 呼出 側 で メール 送信 を skip する。
 */
import type { createServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof createServiceClient>;

export type DailyDigestSummary = {
  /** 今日 (UTC 同日 と JST 同日 の 折衷 として ローカル 日 を 使う) 期限 の タスク 件数 */
  todayTaskCount: number;
  /** 期限 を 過ぎて まだ 完了 して いない タスク 件数 */
  overdueTaskCount: number;
  /** 30 日 沈黙 顧客 数 (対応 中 のみ) */
  silentClientCount: number;
  /** 7 日 status 停止 中 の referrals 数 (introduced / interviewing) */
  stalledReferralCount: number;
};

/**
 * メール を 送る 価値 が ある か (= 何か しら 0 でない 値 が ある か)。
 * 全部 0 なら 「平和な 朝」 と 見なして 送信 skip。
 */
export function digestHasContent(summary: DailyDigestSummary): boolean {
  return (
    summary.todayTaskCount > 0 ||
    summary.overdueTaskCount > 0 ||
    summary.silentClientCount > 0 ||
    summary.stalledReferralCount > 0
  );
}

/**
 * admin 1 人 の 集計 を 返す。
 * - 「自分 宛 タスク」 は assigned_member_id 単位 (= organization_member.id)
 * - 「沈黙 顧客 / 停止 referrals」 は 組織 単位 (admin 全員 共通 の 数字)
 */
export async function computeDailyDigestForAdmin(args: {
  service: Service;
  organizationId: string;
  memberId: string;
  nowIso: string;
}): Promise<DailyDigestSummary> {
  const { service, organizationId, memberId, nowIso } = args;
  const now = new Date(nowIso);
  // 「今日」 は JST 基準 (= organization の メンバー が 朝 に 読む 想定)
  // UTC → JST + 1 日 切り出し で 当日 0:00 / 翌日 0:00 を 算出。
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffsetMs);
  const jstYear = jstNow.getUTCFullYear();
  const jstMonth = jstNow.getUTCMonth();
  const jstDay = jstNow.getUTCDate();
  const todayStartIso = new Date(Date.UTC(jstYear, jstMonth, jstDay) - jstOffsetMs).toISOString();
  const tomorrowStartIso = new Date(
    Date.UTC(jstYear, jstMonth, jstDay + 1) - jstOffsetMs,
  ).toISOString();
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 並列 で 集計 (それぞれ count: 'exact' を 使い 行 を 取得 しない = 安価)
  const [todayTaskRes, overdueTaskRes, clientRowsRes, referralRowsRes] = await Promise.all([
    service
      .from("agency_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("assigned_member_id", memberId)
      .eq("status", "pending")
      .gte("due_at", todayStartIso)
      .lt("due_at", tomorrowStartIso),
    service
      .from("agency_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("assigned_member_id", memberId)
      .eq("status", "pending")
      .lt("due_at", todayStartIso),
    // 沈黙 顧客: status が 終了 系 で ない、 last_interaction_at が 30 日 以上 前
    // (last_interaction_at が null の 行 は createdAt で 判定 する 必要 が あり、
    //  ここ では 単純 化 の ため null は 除外 = 「一度 も 対応 なし」 は ダッシュボード で 見る)
    service
      .from("client_records")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .not("status", "in", "(completed,declined)")
      .lte("last_interaction_at", thirtyDaysAgoIso),
    // 停止 中 の 応募: status が introduced / interviewing で、
    // updated_at が 7 日 以上 前
    service
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["introduced", "interviewing"])
      .lte("updated_at", sevenDaysAgoIso),
  ]);

  return {
    todayTaskCount: todayTaskRes.count ?? 0,
    overdueTaskCount: overdueTaskRes.count ?? 0,
    silentClientCount: clientRowsRes.count ?? 0,
    stalledReferralCount: referralRowsRes.count ?? 0,
  };
}

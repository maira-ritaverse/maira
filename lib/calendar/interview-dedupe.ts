/**
 * interview_round と referrals.company_interview の 重複 抑制 ロジック。
 *
 * 背景:
 *   ・referrals.scheduled_interview_at は 「直近 1 件」 の デノーマライズ 版。
 *   ・interviews テーブル は 1 応募 × 複数 面接 ラウンド の 個別 レコード。
 *   ・ある referral の interview_round が referrals.scheduled_interview_at と
 *     ± 5 分 以内 に 一致 する 場合、 それ は 同一 予定 の 二重 登録 な ので、
 *     interview_round 側 を 優先 し referrals 側 を 抑制 する。
 *
 * 純粋 関数 で 実装 し、 テスト しやすく する。
 */

/** referral_id + 分 単位 epoch の 集合 */
export type SuppressKeys = Set<string>;

/**
 * interview_round の 配列 から、 referrals 側 を 抑制 する べき キー 集合 を 作る。
 * ± 5 分 の 揺れ を 許容 する ため、 各 レコード の 前後 5 分 分 の キー も 追加。
 */
export function buildSuppressKeys(
  rounds: Array<{ referralId: string; scheduledAt: string }>,
  toleranceMinutes = 5,
): SuppressKeys {
  const set = new Set<string>();
  for (const r of rounds) {
    const t = Date.parse(r.scheduledAt);
    if (Number.isNaN(t)) continue;
    const minuteEpoch = Math.floor(t / 60_000);
    for (let delta = -toleranceMinutes; delta <= toleranceMinutes; delta++) {
      set.add(`${r.referralId}:${minuteEpoch + delta}`);
    }
  }
  return set;
}

/**
 * referral の company_interview 予定 を interview_round と 突き合わせて、
 * 抑制 する べき か 判定 する。
 */
export function shouldSuppressReferral(
  referral: { id: string; scheduledInterviewAt: string },
  suppressKeys: SuppressKeys,
): boolean {
  const t = Date.parse(referral.scheduledInterviewAt);
  if (Number.isNaN(t)) return false;
  const minuteEpoch = Math.floor(t / 60_000);
  return suppressKeys.has(`${referral.id}:${minuteEpoch}`);
}

/**
 * kind コード → 日本語 ラウンド ラベル の 対応。
 */
export const INTERVIEW_ROUND_LABEL: Record<
  "first" | "second" | "final" | "offer" | "company",
  "1次" | "2次" | "最終" | "内定" | "企業"
> = {
  first: "1次",
  second: "2次",
  final: "最終",
  offer: "内定",
  company: "企業",
};

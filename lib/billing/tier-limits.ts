/**
 * プラン tier ごと の 「AI 月次総量 上限」 の 純関数 モジュール。
 *
 * なぜ 分離 したか:
 *   - lib/features/ai-usage.ts は Supabase Client と RPC を 直接 叩く
 *   - lib/billing/agency.ts は Database Types と 組み合わさる (enum 参照)
 *   - 両方 が 「tier → 500/1000」 の 同じ 値 を 持って いて 齟齬 が 出やすかった
 *   - このモジュール は Database Types にも Supabase にも 依存 しない 純関数
 *     だけ を 持ち、 単一 の source of truth に する
 *
 * 注:
 *   - PlanTier / PlanStatus 型 は agency.ts でも export して いる が、 こちら は
 *     database.types に 依存 させ たく ない ので 独自 の string literal union で 定義
 *   - agency.ts 側 の 型 と 値 が 完全 一致 する テスト を tier-limits.test.ts に
 *     置いて 齟齬 を 防ぐ
 */

/**
 * 課金 プラン tier (organization_plans.tier enum と 一致)。
 *
 * Team 系 (¥25,000 base + 席数課金):
 *   standard / standard_rec / standard_pro / standard_premium
 *
 * Solo 系 (1 席固定、 base 課金 なし、 セルフサーブ 想定):
 *   solo (¥5,980/月、 AI 100 回)
 *   solo_pro (¥9,800/月、 AI 200 回 + 付加機能)
 */
export type PlanTierValue =
  | "standard"
  | "standard_rec"
  | "standard_pro"
  | "standard_premium"
  | "solo"
  | "solo_pro";

/** 課金 プラン ステータス (organization_plans.status enum と 一致) */
export type PlanStatusValue = "trialing" | "active" | "past_due" | "canceled" | "incomplete";

/** Standard / Standard_rec の 月次 AI 総量 上限 */
export const AI_TOTAL_STANDARD_MONTHLY = 500;

/** Standard_pro / Standard_premium の 月次 AI 総量 上限 */
export const AI_TOTAL_STANDARD_PRO_MONTHLY = 1000;

/** Solo の 月次 AI 総量 上限 (1 席 の 個人 プラン、 保守的 な 上限) */
export const AI_TOTAL_SOLO_MONTHLY = 100;

/** Solo Pro の 月次 AI 総量 上限 (Solo + 100 回) */
export const AI_TOTAL_SOLO_PRO_MONTHLY = 200;

/** トライアル 中 の 月次 AI 総量 上限 (Pro を 試せる ように Pro 相当) */
export const AI_TOTAL_TRIAL_MONTHLY = 1000;

/**
 * トライアル 中 の Solo 系 の 月次 AI 総量 上限 (Solo Pro を 試せる ように
 * Solo Pro 相当)。 Team 系 の Trial (1000) を そのまま 適用 する と 上限 が
 * ある 意味 を なさない ので、 Solo 用 に 別途 設定。
 */
export const AI_TOTAL_SOLO_TRIAL_MONTHLY = 200;

/** プラン 未 開始 組織 の 月次 AI 総量 上限 (安全側 で Standard 相当) */
export const AI_TOTAL_UNPLANNED_MONTHLY = AI_TOTAL_STANDARD_MONTHLY;

/**
 * プラン tier 単独 から AI 総量 上限 を 引く 純関数。
 *
 * トライアル / 免除 / admin 強制 設定 は 呼出側 で 事前 判定 する。
 * ここ は 「tier だけ を 見た 場合 の 数値」 に 責務 を 絞る。
 */
export function getAiTotalLimitByTier(tier: PlanTierValue): number {
  switch (tier) {
    case "standard":
    case "standard_rec":
      return AI_TOTAL_STANDARD_MONTHLY;
    case "standard_pro":
    case "standard_premium":
      return AI_TOTAL_STANDARD_PRO_MONTHLY;
    case "solo":
      return AI_TOTAL_SOLO_MONTHLY;
    case "solo_pro":
      return AI_TOTAL_SOLO_PRO_MONTHLY;
  }
}

/**
 * tier が Solo 系 か どうか。 トライアル 上限 の 分岐 や UI 表示 の 出し 分け に 使う。
 */
export function isSoloTier(tier: PlanTierValue): boolean {
  return tier === "solo" || tier === "solo_pro";
}

/**
 * organization_plans 行 の 各種 状態 から 「実効 AI 総量 上限」 を 決定 する 純関数。
 *
 * 判定 順序:
 *   1. トライアル 中 (status=trialing かつ trial_ends_at > now) → 1000
 *   2. is_billing_exempt = true → 現時点 は tier 通り (= 500 / 1000)
 *      ・「免除 = 無料 + Standard 機能」 の 方針
 *      ・将来 「免除 = Pro 相当」 に 変えたく なった 場合 は ここ 1 箇所 を 変える
 *   3. それ 以外 → tier 通り
 *
 * plan が null (プラン 未開始 組織) → 呼出側 で 500 に フォールバック する。
 */
export function getAiTotalLimitForPlan(
  plan: {
    tier: PlanTierValue;
    status: PlanStatusValue;
    trialEndsAt: string | null;
    isBillingExempt: boolean;
  },
  now: Date = new Date(),
): number {
  // 1. トライアル 中 は 上位相当 上限。 Solo 系 の トライアル は Solo Pro 相当
  //    (Team 系 の Trial 1000 を Solo に 適用 する と 意味 を なさない ため)。
  if (plan.status === "trialing" && plan.trialEndsAt) {
    if (new Date(plan.trialEndsAt).getTime() > now.getTime()) {
      return isSoloTier(plan.tier) ? AI_TOTAL_SOLO_TRIAL_MONTHLY : AI_TOTAL_TRIAL_MONTHLY;
    }
  }

  // 2. 課金 免除 は 現時点 で は tier 通り の 挙動 (下 に フォール スルー)。
  //    ここ を `return AI_TOTAL_STANDARD_PRO_MONTHLY` に 変える と
  //    「免除 = Pro 相当」 の 方針 に 切り替わる。
  //    2026-07-03 時点 の 決定: Standard 相当 で 開始。
  //    isBillingExempt 参照 の 明示 (未使用 警告 回避 も 兼ねる)
  void plan.isBillingExempt;

  // 3. tier だけ で 判定
  return getAiTotalLimitByTier(plan.tier);
}

/**
 * 組織 プラン の 「今 使える 状態 か」 を 判定 する 純関数 群。
 *
 * 使い分け:
 *   ・isPlanReadOnly(plan)  → 読み取り 専用 モード に する べき か
 *   ・getTrialCountdown(plan) → 無料 期間 の 残 日 数 (トライアル 中 のみ)
 *   ・shouldShowTrialReminder(plan) → 7 日 前 か ら の リマインダー 対象 か
 *
 * 「読み取り 専用」 の 定義:
 *   ・status='canceled' … Stripe 側 で 契約 終了、 or トライアル 未 決済 で
 *     期限 切れ を 迎えた
 *   ・status='trialing' かつ trial_ends_at < 今 … 未 決済 で 期限 過ぎ た が
 *     cron 未 反映 な 状態 (取り こぼし 保険)
 *   ・status='past_due' … 決済 失敗 中 (Stripe が 数 回 リトライ し て 復旧 でき
 *     なけ れ ば canceled に なる。 リトライ 中 も 保守 的 に 読み 取り 専用)
 *
 * incomplete (初回 決済 未 完了) は Checkout し 直せ ば 復旧 する 一時 状態 な ので、
 * 課金 ページ の 動線 だけ 見せて、 それ 以外 は 読み 取り 専用 扱い で 統一 する。
 */

/** 課金 判定 に 必要 な plan の 最小 形。 */
export type PlanReadState = {
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
  is_billing_exempt: boolean;
};

/**
 * 読み 取り 専用 モード に す べき か。
 *
 * 免除 組織 (is_billing_exempt=true) は 常 に フル 権限 で 使える (運営 判断 の
 * 特別 扱い)。
 */
export function isPlanReadOnly(plan: PlanReadState | null, now: Date = new Date()): boolean {
  if (!plan) return false; // 行 が 無い ケース は プラン 加入 前 の 通常 動線
  if (plan.is_billing_exempt) return false;

  if (plan.status === "canceled") return true;
  if (plan.status === "past_due") return true;
  if (plan.status === "incomplete") return true;

  if (plan.status === "trialing") {
    if (!plan.trial_ends_at) return false;
    const trialEnd = new Date(plan.trial_ends_at).getTime();
    if (trialEnd < now.getTime()) {
      // トライアル 期限 切れ で Stripe 契約 が 無い 場合 は 読み 取り 専用
      // (Stripe 契約 あり なら Webhook が active に 遷移 させる 前 の 一瞬 のみ)
      return !plan.stripe_subscription_id;
    }
    return false;
  }

  return false; // active
}

/**
 * トライアル 残 日 数 (切り 上げ)。 トライアル 中 で なけ れ ば null。
 * リマインダー / カウント ダウン に 使う。
 */
export function getTrialCountdown(
  plan: PlanReadState | null,
  now: Date = new Date(),
): number | null {
  if (!plan) return null;
  if (plan.status !== "trialing") return null;
  if (!plan.trial_ends_at) return null;
  const diffMs = new Date(plan.trial_ends_at).getTime() - now.getTime();
  if (diffMs <= 0) return null; // 期限 切れ は リマインダー 対象 外
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * トライアル 終了 リマインダー を 出す べき か (残 7 日 以内)。
 * すで に Stripe 契約 済み (stripe_subscription_id あり) の 場合 も、
 * 「無料 期間 が 終わる = 引き 落とし が 始まる」 なので 案内 は 出す。
 * 免除 組織 は 除外。
 */
export function shouldShowTrialReminder(
  plan: PlanReadState | null,
  now: Date = new Date(),
): boolean {
  if (!plan || plan.is_billing_exempt) return false;
  const days = getTrialCountdown(plan, now);
  if (days === null) return false;
  return days <= 7;
}

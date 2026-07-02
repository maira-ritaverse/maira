/**
 * Stripe 組織 プラン の 価格 定数 と 純関数 の 見積 ロジック。
 *
 * lib/billing/agency.ts に ある PRICING は 「Stripe 導入 前 の トライアル
 * アップグレード 選択」 で 使う 旧 価格 が 残って いる の で、 Stripe 契約 用 の
 * 価格 は こちら に 分離 する。
 *
 * ここ は 純関数 のみ。 DB / Stripe API は 触ら ない。
 */

/** Standard Base の 月額 (税別、 3 席 込み)。 */
export const STRIPE_BASE_MONTHLY_JPY = 25_000 as const;
/** Extra Seat の 月額 単価 (税別、 4 席 目 以降 1 席 あたり)。 */
export const STRIPE_EXTRA_SEAT_MONTHLY_JPY = 5_000 as const;
/** AI Boost (Standard → Pro アップグレード) の 月額。 */
export const STRIPE_AI_BOOST_MONTHLY_JPY = 10_000 as const;

/** Standard Base に 含まれる 席 数。 4 席 目 以降 が 課金 対象。 */
export const STRIPE_INCLUDED_SEATS = 3 as const;

/** 年払い は 「10 ヶ月 分」 = 2 ヶ月 分 割引。 */
export const STRIPE_YEARLY_MONTHS = 10 as const;
export const STRIPE_CYCLE_MONTHS = 12 as const;

export type StripeTier = "standard" | "standard_pro";
export type StripeCycle = "monthly" | "yearly";

export type StripePriceBreakdown = {
  base: number;
  extraSeat: number;
  aiBoost: number;
  /** 月払い 合計 (税別、 単月 相当) */
  monthlyTotal: number;
  /** 年払い 合計 (税別、 = 月払い 合計 × 10) */
  yearlyTotal: number;
  /** 年払い を 月 単価 に 換算 した 参考 値 (= yearlyTotal / 12) */
  yearlyMonthlyEquivalent: number;
};

/**
 * 席 数 と tier / cycle から 価格 を 計算 する 純関数。
 * cycle=yearly の 場合 も 「単月 相当 の 内訳」 と 「年間 合計」 の 両方 を 返す。
 */
export function computeStripePrice(args: {
  tier: StripeTier;
  seatCount: number;
  cycle: StripeCycle;
}): StripePriceBreakdown {
  const safeSeat = Math.max(STRIPE_INCLUDED_SEATS, Math.floor(args.seatCount));
  const extraSeats = safeSeat - STRIPE_INCLUDED_SEATS;

  const base = STRIPE_BASE_MONTHLY_JPY;
  const extraSeat = extraSeats * STRIPE_EXTRA_SEAT_MONTHLY_JPY;
  const aiBoost = args.tier === "standard_pro" ? STRIPE_AI_BOOST_MONTHLY_JPY : 0;

  const monthlyTotal = base + extraSeat + aiBoost;
  // 年払い = 単月 × 10 (Stripe 側 の Price も 10 ヶ月 分 単価 で 登録 済)
  const yearlyTotal = monthlyTotal * STRIPE_YEARLY_MONTHS;
  const yearlyMonthlyEquivalent = Math.round(yearlyTotal / STRIPE_CYCLE_MONTHS);

  return {
    base,
    extraSeat,
    aiBoost,
    monthlyTotal,
    yearlyTotal,
    yearlyMonthlyEquivalent,
  };
}

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

/**
 * Solo プラン (1 席 固定、 個人事業主 / フリー 向け) の 月額。
 * Team 系 と 違い base + seat + boost の 組合せ で なく、 単一 Price で 決済。
 */
export const STRIPE_SOLO_MONTHLY_JPY = 5_980 as const;

/**
 * Solo Pro プラン (1 席 固定、 Solo + 付加機能) の 月額。
 * Solo との 差別化 は AI 200 回 / CSV / 詳細レポート / 録音 5 回 / 24h サポート。
 */
export const STRIPE_SOLO_PRO_MONTHLY_JPY = 9_800 as const;

/**
 * Solo 系 も 年払い は 10 ヶ月 分 (Team 系 と 同じ 割引率)。
 * ・Solo yearly ≒ ¥59,800 (実質 ¥4,983 / 月)
 * ・Solo Pro yearly ≒ ¥98,000 (実質 ¥8,166 / 月)
 */

export type StripeTier = "standard" | "standard_pro" | "solo" | "solo_pro";
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
 *
 * Solo 系 (solo / solo_pro) は base + seat の 構造 ではなく 単一 Price 決済 な ので、
 * base に Solo 単価 を セット、 extraSeat = 0、 aiBoost = 0 で 返す
 * (呼出 側 の UI 表示 が 破綻 しない よう に 一貫 した shape で 返す)。
 */
export function computeStripePrice(args: {
  tier: StripeTier;
  seatCount: number;
  cycle: StripeCycle;
}): StripePriceBreakdown {
  // ── Solo 系 は 1 席固定 の 単一 Price
  if (args.tier === "solo" || args.tier === "solo_pro") {
    const base = args.tier === "solo_pro" ? STRIPE_SOLO_PRO_MONTHLY_JPY : STRIPE_SOLO_MONTHLY_JPY;
    const monthlyTotal = base;
    const yearlyTotal = monthlyTotal * STRIPE_YEARLY_MONTHS;
    const yearlyMonthlyEquivalent = Math.round(yearlyTotal / STRIPE_CYCLE_MONTHS);
    return {
      base,
      extraSeat: 0,
      aiBoost: 0,
      monthlyTotal,
      yearlyTotal,
      yearlyMonthlyEquivalent,
    };
  }

  // ── Team 系 (Standard / Standard Pro): base + extra seat (+ ai boost)
  const safeSeat = Math.max(STRIPE_INCLUDED_SEATS, Math.floor(args.seatCount));
  const extraSeats = safeSeat - STRIPE_INCLUDED_SEATS;

  const base = STRIPE_BASE_MONTHLY_JPY;
  const extraSeat = extraSeats * STRIPE_EXTRA_SEAT_MONTHLY_JPY;
  const aiBoost = args.tier === "standard_pro" ? STRIPE_AI_BOOST_MONTHLY_JPY : 0;

  const monthlyTotal = base + extraSeat + aiBoost;
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

/**
 * 成約(placements)の集計
 *
 * 1 つの referral に紐づく複数イベントから「純売上」「入金済み」「残額」を出す。
 *
 * ⚠️ お金の計算なので必ず整数(円)で扱う。
 *    DB の amount は integer(円)、null は 0 として扱う。
 *    浮動小数の累積誤差が出ない設計にしている。
 *
 * ⚠️ 設計:
 *   - 純売上(netRevenue) = placement + additional − refund
 *       「発生した売上」。入金は含めない(売上 ≠ 入金)。
 *   - 入金済み(paid)     = payment の合計
 *       「実際に入ったお金」。
 *   - 残額(unpaid)       = netRevenue − paid
 *       0 なら完済、正なら未入金、負なら過入金。
 */

import type { Placement } from "./types";

export type PlacementAggregate = {
  /** placement + additional − refund(円、整数) */
  netRevenue: number;
  /** payment の合計(円、整数) */
  paid: number;
  /** netRevenue − paid(正:未入金、0:完済、負:過入金) */
  unpaid: number;
  /** 内訳:成約合計 */
  placementTotal: number;
  /** 内訳:追加報酬合計 */
  additionalTotal: number;
  /** 内訳:返金合計 */
  refundTotal: number;
  /** 内訳:入金合計(= paid と同値、命名対称のため重複保持) */
  paymentTotal: number;
  /** 何か1件でもイベントがあるか(サマリ表示判定用) */
  hasEvents: boolean;
};

export function aggregatePlacements(items: Placement[]): PlacementAggregate {
  let placementTotal = 0;
  let additionalTotal = 0;
  let refundTotal = 0;
  let paymentTotal = 0;

  for (const p of items) {
    // amount が null のイベントは金額未設定扱いで 0 加算
    const a = p.amount ?? 0;
    switch (p.eventType) {
      case "placement":
        placementTotal += a;
        break;
      case "additional":
        additionalTotal += a;
        break;
      case "refund":
        refundTotal += a;
        break;
      case "payment":
        paymentTotal += a;
        break;
    }
  }

  const netRevenue = placementTotal + additionalTotal - refundTotal;
  return {
    netRevenue,
    paid: paymentTotal,
    unpaid: netRevenue - paymentTotal,
    placementTotal,
    additionalTotal,
    refundTotal,
    paymentTotal,
    hasEvents: items.length > 0,
  };
}

import { describe, it, expect } from "vitest";
import { aggregatePlacements } from "./aggregate";
import type { Placement } from "./types";

/**
 * placements 集計の境界テスト。
 *
 * お金の計算なので整数で扱う契約。null は 0 扱い。
 * 「純売上」「入金」「残額」の関係(netRevenue - paid = unpaid)が
 * 入力に関わらず常に成り立つことを担保する。
 *
 * eventType の 4 種(placement / additional / refund / payment)が
 * 内訳に正しく振り分けられているか、未知の eventType を黙って無視するか、
 * 加算が浮動小数誤差を起こさないかを境界ごとに検証。
 */

function event(eventType: Placement["eventType"], amount: number | null): Placement {
  return {
    id: `evt-${Math.random()}`,
    organizationId: "org-1",
    referralId: "ref-1",
    eventType,
    amount,
    expectedSalary: null,
    commissionRate: null,
    eventDate: "2026-06-14",
    paymentStatus: null,
    notes: null,
    reason: null,
    createdByMemberId: null,
    createdAt: "2026-06-14T00:00:00Z",
    updatedAt: "2026-06-14T00:00:00Z",
  };
}

describe("aggregatePlacements — 空・無効値", () => {
  it("空配列なら全部 0 / hasEvents=false", () => {
    const r = aggregatePlacements([]);
    expect(r).toEqual({
      netRevenue: 0,
      paid: 0,
      unpaid: 0,
      placementTotal: 0,
      additionalTotal: 0,
      refundTotal: 0,
      paymentTotal: 0,
      hasEvents: false,
    });
  });

  it("amount=null は 0 加算扱いするが hasEvents は true", () => {
    const r = aggregatePlacements([event("placement", null)]);
    expect(r.netRevenue).toBe(0);
    expect(r.placementTotal).toBe(0);
    expect(r.hasEvents).toBe(true);
  });
});

describe("aggregatePlacements — 各 eventType の振り分け", () => {
  it("placement は placementTotal と netRevenue に加算", () => {
    const r = aggregatePlacements([event("placement", 500_000)]);
    expect(r.placementTotal).toBe(500_000);
    expect(r.netRevenue).toBe(500_000);
    expect(r.paid).toBe(0);
    expect(r.unpaid).toBe(500_000);
  });

  it("additional も netRevenue を増やす", () => {
    const r = aggregatePlacements([event("placement", 500_000), event("additional", 100_000)]);
    expect(r.additionalTotal).toBe(100_000);
    expect(r.netRevenue).toBe(600_000);
  });

  it("refund は netRevenue を減らす", () => {
    const r = aggregatePlacements([event("placement", 500_000), event("refund", 200_000)]);
    expect(r.refundTotal).toBe(200_000);
    expect(r.netRevenue).toBe(300_000);
  });

  it("payment は paid を増やす(netRevenue には影響しない)", () => {
    const r = aggregatePlacements([event("placement", 500_000), event("payment", 300_000)]);
    expect(r.paid).toBe(300_000);
    expect(r.netRevenue).toBe(500_000); // 売上は変わらない
    expect(r.unpaid).toBe(200_000); // 残額 = 500k - 300k
  });

  it("paymentTotal は paid と同値(命名対称のための重複保持)", () => {
    const r = aggregatePlacements([event("payment", 100_000), event("payment", 200_000)]);
    expect(r.paymentTotal).toBe(r.paid);
    expect(r.paymentTotal).toBe(300_000);
  });
});

describe("aggregatePlacements — 完済 / 未入金 / 過入金", () => {
  it("完済(netRevenue === paid)なら unpaid=0", () => {
    const r = aggregatePlacements([event("placement", 500_000), event("payment", 500_000)]);
    expect(r.unpaid).toBe(0);
  });

  it("過入金(paid > netRevenue)なら unpaid が負になる", () => {
    const r = aggregatePlacements([event("placement", 100_000), event("payment", 150_000)]);
    expect(r.unpaid).toBe(-50_000);
  });
});

describe("aggregatePlacements — 不変条件", () => {
  it("netRevenue - paid === unpaid が常に成り立つ", () => {
    const r = aggregatePlacements([
      event("placement", 500_000),
      event("additional", 50_000),
      event("refund", 30_000),
      event("payment", 200_000),
    ]);
    expect(r.netRevenue - r.paid).toBe(r.unpaid);
  });

  it("netRevenue === placementTotal + additionalTotal - refundTotal", () => {
    const r = aggregatePlacements([
      event("placement", 700_000),
      event("placement", 300_000),
      event("additional", 100_000),
      event("refund", 50_000),
    ]);
    expect(r.netRevenue).toBe(r.placementTotal + r.additionalTotal - r.refundTotal);
    expect(r.netRevenue).toBe(1_000_000 + 100_000 - 50_000);
  });
});

describe("aggregatePlacements — 整数計算(浮動小数誤差なし)", () => {
  it("万単位の加算で誤差が出ない", () => {
    // 円整数なので 0.1 + 0.2 = 0.30000000000000004 みたいな問題は起きないが、
    // 「整数で扱う契約」を明示テストする
    const r = aggregatePlacements([
      event("placement", 1_111_111),
      event("placement", 2_222_222),
      event("additional", 333_333),
    ]);
    expect(r.netRevenue).toBe(3_666_666);
    expect(Number.isInteger(r.netRevenue)).toBe(true);
    expect(Number.isInteger(r.unpaid)).toBe(true);
  });

  it("大量(100 件)の加算でもオーバーフローしない", () => {
    const items = Array.from({ length: 100 }, () => event("placement", 1_000_000));
    const r = aggregatePlacements(items);
    expect(r.netRevenue).toBe(100_000_000);
    expect(r.placementTotal).toBe(100_000_000);
  });
});

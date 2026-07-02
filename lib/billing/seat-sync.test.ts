import { describe, expect, it } from "vitest";

import { SEAT_BASE_INCLUDED, computeExtraSeatQuantity } from "./seat-sync";

describe("computeExtraSeatQuantity", () => {
  it("SEAT_BASE_INCLUDED は 3", () => {
    expect(SEAT_BASE_INCLUDED).toBe(3);
  });

  it("3 名 まで は Extra Seat 0", () => {
    expect(computeExtraSeatQuantity(0).extraSeatQuantity).toBe(0);
    expect(computeExtraSeatQuantity(1).extraSeatQuantity).toBe(0);
    expect(computeExtraSeatQuantity(2).extraSeatQuantity).toBe(0);
    expect(computeExtraSeatQuantity(3).extraSeatQuantity).toBe(0);
  });

  it("4 名 → Extra Seat 1", () => {
    expect(computeExtraSeatQuantity(4)).toEqual({
      memberCount: 4,
      extraSeatQuantity: 1,
    });
  });

  it("100 名 → Extra Seat 97", () => {
    expect(computeExtraSeatQuantity(100)).toEqual({
      memberCount: 100,
      extraSeatQuantity: 97,
    });
  });

  it("負 数 は 0 に 切り 上げ (防御)", () => {
    expect(computeExtraSeatQuantity(-5)).toEqual({
      memberCount: 0,
      extraSeatQuantity: 0,
    });
  });

  it("小数 は 切り 捨て (防御)", () => {
    expect(computeExtraSeatQuantity(4.7)).toEqual({
      memberCount: 4,
      extraSeatQuantity: 1,
    });
  });
});

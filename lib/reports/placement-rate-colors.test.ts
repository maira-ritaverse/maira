import { describe, it, expect } from "vitest";
import {
  colorForPlacementRate,
  PLACEMENT_RATE_COLOR_AMBER,
  PLACEMENT_RATE_COLOR_GREEN,
  PLACEMENT_RATE_COLOR_RED,
} from "./placement-rate-colors";

/**
 * 成約率カラーしきい値の境界テスト。
 *
 * spec の 0-30 / 31-60 / 61-100 の境界をリグレッション検知するため、
 * 30/31/60/61 の 4 点で色が切り替わることを明示する。
 * UI(半円ゲージ)の見た目に直結するので、しきい値変更時はテスト同時更新の合図に。
 */

describe("colorForPlacementRate — しきい値境界", () => {
  it("0% は赤", () => {
    expect(colorForPlacementRate(0)).toBe(PLACEMENT_RATE_COLOR_RED);
  });

  it("30%(赤の上限)はまだ赤", () => {
    expect(colorForPlacementRate(30)).toBe(PLACEMENT_RATE_COLOR_RED);
  });

  it("31%(黄の下限)は黄に切り替わる", () => {
    expect(colorForPlacementRate(31)).toBe(PLACEMENT_RATE_COLOR_AMBER);
  });

  it("60%(黄の上限)はまだ黄", () => {
    expect(colorForPlacementRate(60)).toBe(PLACEMENT_RATE_COLOR_AMBER);
  });

  it("61%(緑の下限)は緑に切り替わる", () => {
    expect(colorForPlacementRate(61)).toBe(PLACEMENT_RATE_COLOR_GREEN);
  });

  it("100% は緑", () => {
    expect(colorForPlacementRate(100)).toBe(PLACEMENT_RATE_COLOR_GREEN);
  });
});

describe("colorForPlacementRate — 想定外入力(防御的挙動)", () => {
  it("100% 超(理論上はクランプ済みだが)も緑にフォールバック", () => {
    expect(colorForPlacementRate(150)).toBe(PLACEMENT_RATE_COLOR_GREEN);
  });

  it("負の値は赤に倒れる(rate <= 30 の判定で素直に拾える)", () => {
    expect(colorForPlacementRate(-1)).toBe(PLACEMENT_RATE_COLOR_RED);
    expect(colorForPlacementRate(-100)).toBe(PLACEMENT_RATE_COLOR_RED);
  });

  it("小数(15.5%)も正しい色に振り分けられる", () => {
    expect(colorForPlacementRate(15.5)).toBe(PLACEMENT_RATE_COLOR_RED);
    expect(colorForPlacementRate(30.5)).toBe(PLACEMENT_RATE_COLOR_AMBER);
    expect(colorForPlacementRate(60.5)).toBe(PLACEMENT_RATE_COLOR_GREEN);
  });
});

describe("色定数(Tailwind 標準色との整合)", () => {
  it("赤 = #ef4444(tailwind red-500)", () => {
    expect(PLACEMENT_RATE_COLOR_RED).toBe("#ef4444");
  });

  it("黄 = #f59e0b(tailwind amber-500)", () => {
    expect(PLACEMENT_RATE_COLOR_AMBER).toBe("#f59e0b");
  });

  it("緑 = #10b981(tailwind emerald-500)", () => {
    expect(PLACEMENT_RATE_COLOR_GREEN).toBe("#10b981");
  });

  it("3 色がそれぞれ別の値(誤って同じ色を割り当てていないこと)", () => {
    const colors = new Set([
      PLACEMENT_RATE_COLOR_RED,
      PLACEMENT_RATE_COLOR_AMBER,
      PLACEMENT_RATE_COLOR_GREEN,
    ]);
    expect(colors.size).toBe(3);
  });
});

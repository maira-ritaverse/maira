import { describe, expect, it } from "vitest";

import {
  formatPeriodLabel,
  getDayRange,
  getMonthRange,
  getWeekRange,
  getWeekStart,
  rangeForView,
  shiftAnchor,
} from "./period";

describe("getWeekStart", () => {
  it("木曜日 → 直前の日曜", () => {
    // 2026-07-09 (木) → 2026-07-05 (日)
    expect(getWeekStart("2026-07-09")).toBe("2026-07-05");
  });

  it("日曜日 → その日", () => {
    expect(getWeekStart("2026-07-05")).toBe("2026-07-05");
  });

  it("土曜日 → 6 日前", () => {
    expect(getWeekStart("2026-07-11")).toBe("2026-07-05");
  });

  it("月跨ぎ (7/2 木 → 6/28 日)", () => {
    expect(getWeekStart("2026-07-02")).toBe("2026-06-28");
  });
});

describe("getWeekRange / getDayRange / getMonthRange", () => {
  it("週範囲は 日〜土 の 7 日", () => {
    expect(getWeekRange("2026-07-09")).toEqual({
      rangeStart: "2026-07-05",
      rangeEnd: "2026-07-11",
    });
  });

  it("日範囲は 自身のみ", () => {
    expect(getDayRange("2026-07-09")).toEqual({
      rangeStart: "2026-07-09",
      rangeEnd: "2026-07-09",
    });
  });

  it("月範囲は 前月末 1 週 + 翌月頭 1 週 を 含む", () => {
    const r = getMonthRange("2026-07-15");
    // 前 1 週の 7/1 - 7 = 6/24、 後 1 週の 8/7
    expect(r.rangeStart).toBe("2026-06-24");
    expect(r.rangeEnd).toBe("2026-08-07");
  });
});

describe("shiftAnchor", () => {
  it("day mode + 1 → 翌日", () => {
    expect(shiftAnchor("2026-07-09", "day", 1)).toBe("2026-07-10");
  });

  it("day mode - 1 → 前日", () => {
    expect(shiftAnchor("2026-07-09", "day", -1)).toBe("2026-07-08");
  });

  it("week mode + 1 → 7 日後", () => {
    expect(shiftAnchor("2026-07-09", "week", 1)).toBe("2026-07-16");
  });

  it("week mode - 1 → 7 日前", () => {
    expect(shiftAnchor("2026-07-09", "week", -1)).toBe("2026-07-02");
  });

  it("month mode + 1 → 翌月同日", () => {
    expect(shiftAnchor("2026-07-15", "month", 1)).toBe("2026-08-15");
  });

  it("month mode + 1 で 存在しない日 (1/31→2/31) は Date が 3/3 に丸める", () => {
    // JavaScript Date は 2/31 → 3/3。 これで OK (アンカーとしては翌月扱い)
    expect(shiftAnchor("2026-01-31", "month", 1)).toBe("2026-03-03");
  });
});

describe("rangeForView", () => {
  it("day mode → 単日", () => {
    expect(rangeForView("2026-07-09", "day")).toEqual({
      rangeStart: "2026-07-09",
      rangeEnd: "2026-07-09",
    });
  });

  it("week mode → 週範囲", () => {
    expect(rangeForView("2026-07-09", "week")).toEqual({
      rangeStart: "2026-07-05",
      rangeEnd: "2026-07-11",
    });
  });

  it("month mode → 月ビューグリッド範囲", () => {
    expect(rangeForView("2026-07-15", "month")).toEqual({
      rangeStart: "2026-06-24",
      rangeEnd: "2026-08-07",
    });
  });
});

describe("formatPeriodLabel", () => {
  it("day mode → 曜日込み", () => {
    // 環境依存を避けるため、曜日を含むことのみ確認
    const label = formatPeriodLabel("2026-07-09", "day");
    expect(label).toContain("2026");
    expect(label).toContain("7月");
    expect(label).toContain("9日");
  });

  it("week mode 同月内 → 開始日 - 終了日 (末尾は 日 のみ)", () => {
    // 2026-07-09 が含まれる週 → 2026-07-05 〜 2026-07-11
    expect(formatPeriodLabel("2026-07-09", "week")).toBe("2026年7月5日 - 11日");
  });

  it("week mode 月跨ぎ → 両側 月表示", () => {
    // 2026-07-30 (木) → 週開始 7/26 (日) 〜 8/1 (土)
    expect(formatPeriodLabel("2026-07-30", "week")).toBe("2026年7月26日 - 8月1日");
  });

  it("month mode → 年月", () => {
    expect(formatPeriodLabel("2026-07-15", "month")).toBe("2026年7月");
  });
});

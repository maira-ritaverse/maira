import { describe, expect, it } from "vitest";

import { calculateAge, formatAgeLabel } from "./age";

describe("calculateAge", () => {
  it("誕生日 直前 は 前年 の 年齢 に なる", () => {
    // 生年月日 1990-06-15、 参照 日 2026-06-14 = 誕生日 前日
    expect(calculateAge("1990-06-15", new Date("2026-06-14"))).toBe(35);
  });

  it("誕生日 当日 は 満 年齢 が 1 上がる", () => {
    expect(calculateAge("1990-06-15", new Date("2026-06-15"))).toBe(36);
  });

  it("誕生日 翌日 も 同じ 満年齢", () => {
    expect(calculateAge("1990-06-15", new Date("2026-06-16"))).toBe(36);
  });

  it("YYYY/MM/DD 形式 も 受け付ける", () => {
    expect(calculateAge("2000/01/01", new Date("2026-07-02"))).toBe(26);
  });

  it("Date オブジェクト も 受け付ける", () => {
    expect(calculateAge(new Date("1990-06-15"), new Date("2026-06-30"))).toBe(36);
  });

  it("空 / null / undefined は null を 返す", () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
    expect(calculateAge("")).toBeNull();
  });

  it("不正 形式 は null を 返す", () => {
    expect(calculateAge("not-a-date")).toBeNull();
    expect(calculateAge("2026-13-40")).toBeNull();
  });

  it("未来 の 日付 は 負の 値 に なる", () => {
    expect(calculateAge("2030-01-01", new Date("2026-07-02"))).toBeLessThan(0);
  });
});

describe("formatAgeLabel", () => {
  it("通常 の 生年月日 は 「満 X 歳」 の 文字列 を 返す", () => {
    expect(formatAgeLabel("1990-06-15", new Date("2026-06-30"))).toBe("満 36 歳");
  });

  it("未指定 / 不正 は null を 返す", () => {
    expect(formatAgeLabel(null)).toBeNull();
    expect(formatAgeLabel("bad")).toBeNull();
  });

  it("未来 日付 / 150 超 は null を 返す", () => {
    expect(formatAgeLabel("2030-01-01", new Date("2026-07-02"))).toBeNull();
    expect(formatAgeLabel("1800-01-01", new Date("2026-07-02"))).toBeNull();
  });
});

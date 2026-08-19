import { describe, it, expect, vi, afterEach } from "vitest";

import { todayInJst } from "./jst";

describe("todayInJst", () => {
  afterEach(() => vi.useRealTimers());

  it("YYYY-MM-DD 形式を返す", () => {
    expect(todayInJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("JST 早朝(UTC はまだ前日)でも JST の当日を返す", () => {
    vi.useFakeTimers();
    // 2026-08-19 02:00 JST = 2026-08-18 17:00 UTC
    vi.setSystemTime(new Date("2026-08-18T17:00:00Z"));
    expect(todayInJst()).toBe("2026-08-19");
    // 旧実装(UTC 切り出し)は前日になっていたことの確認
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-08-18");
  });

  it("JST 8:59(UTC 23:59 = 前日)でも当日を返す", () => {
    vi.useFakeTimers();
    // 2026-08-19 08:59 JST = 2026-08-18 23:59 UTC
    vi.setSystemTime(new Date("2026-08-18T23:59:00Z"));
    expect(todayInJst()).toBe("2026-08-19");
  });

  it("JST 昼(UTC も同日)でも当日を返す", () => {
    vi.useFakeTimers();
    // 2026-08-19 12:00 JST = 2026-08-19 03:00 UTC
    vi.setSystemTime(new Date("2026-08-19T03:00:00Z"));
    expect(todayInJst()).toBe("2026-08-19");
  });
});

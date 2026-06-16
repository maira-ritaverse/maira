import { describe, expect, it } from "vitest";

import { isRecentlyUpdated } from "./queries";

describe("isRecentlyUpdated", () => {
  const now = new Date("2026-06-24T00:00:00Z");

  it("今日の更新は true", () => {
    expect(isRecentlyUpdated("2026-06-24T00:00:00Z", now)).toBe(true);
  });

  it("3 日前は true", () => {
    expect(isRecentlyUpdated("2026-06-21T00:00:00Z", now)).toBe(true);
  });

  it("7 日ちょうど前は false(< 7 日のみ true)", () => {
    expect(isRecentlyUpdated("2026-06-17T00:00:00Z", now)).toBe(false);
  });

  it("10 日前は false", () => {
    expect(isRecentlyUpdated("2026-06-14T00:00:00Z", now)).toBe(false);
  });

  it("不正な文字列は false", () => {
    expect(isRecentlyUpdated("not-a-date", now)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isTokenExpired } from "./zoom";

describe("isTokenExpired", () => {
  const now = new Date("2026-06-21T00:00:00Z");

  it("null は expired 扱い", () => {
    expect(isTokenExpired(null, now)).toBe(true);
  });

  it("過去の期限は expired", () => {
    expect(isTokenExpired("2026-06-20T23:00:00Z", now)).toBe(true);
  });

  it("60 秒未満なら expired 扱い(リフレッシュしておく)", () => {
    expect(isTokenExpired("2026-06-21T00:00:30Z", now)).toBe(true);
  });

  it("60 秒以上の余裕があれば valid", () => {
    expect(isTokenExpired("2026-06-21T00:05:00Z", now)).toBe(false);
  });

  it("不正な文字列は expired 扱い", () => {
    expect(isTokenExpired("not-a-date", now)).toBe(true);
  });
});

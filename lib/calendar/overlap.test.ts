import { describe, expect, it } from "vitest";

import { compareByStartTime, detectOverlaps } from "./overlap";

describe("detectOverlaps", () => {
  it("時刻を持たないイベントは対象外", () => {
    const result = detectOverlaps([
      { id: "a", startsAt: "", endsAt: null },
      { id: "b", startsAt: "invalid", endsAt: null },
    ]);
    expect(result.size).toBe(0);
  });

  it("非重複の 2 件は返さない", () => {
    const result = detectOverlaps([
      { id: "a", startsAt: "2026-01-01T10:00:00+09:00", endsAt: "2026-01-01T11:00:00+09:00" },
      { id: "b", startsAt: "2026-01-01T11:00:00+09:00", endsAt: "2026-01-01T12:00:00+09:00" },
    ]);
    expect(result.size).toBe(0);
  });

  it("重複する 2 件を両方 返す", () => {
    const result = detectOverlaps([
      { id: "a", startsAt: "2026-01-01T10:00:00+09:00", endsAt: "2026-01-01T11:00:00+09:00" },
      { id: "b", startsAt: "2026-01-01T10:30:00+09:00", endsAt: "2026-01-01T11:30:00+09:00" },
    ]);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("endsAt が無いイベントは +30 分 の 仮想区間 で 判定", () => {
    const result = detectOverlaps([
      { id: "a", startsAt: "2026-01-01T10:00:00+09:00", endsAt: null }, // 10:00-10:30
      { id: "b", startsAt: "2026-01-01T10:15:00+09:00", endsAt: null }, // 10:15-10:45
    ]);
    expect(result.size).toBe(2);
  });

  it("groupKey が異なるイベントは重ならない", () => {
    const result = detectOverlaps([
      {
        id: "a",
        startsAt: "2026-01-01T10:00:00+09:00",
        endsAt: "2026-01-01T11:00:00+09:00",
        groupKey: "member-1",
      },
      {
        id: "b",
        startsAt: "2026-01-01T10:00:00+09:00",
        endsAt: "2026-01-01T11:00:00+09:00",
        groupKey: "member-2",
      },
    ]);
    expect(result.size).toBe(0);
  });

  it("同 groupKey で 3 件が連鎖的に重なる場合", () => {
    const result = detectOverlaps([
      {
        id: "a",
        startsAt: "2026-01-01T10:00:00+09:00",
        endsAt: "2026-01-01T12:00:00+09:00",
      },
      {
        id: "b",
        startsAt: "2026-01-01T11:00:00+09:00",
        endsAt: "2026-01-01T13:00:00+09:00",
      },
      {
        id: "c",
        startsAt: "2026-01-01T12:30:00+09:00",
        endsAt: "2026-01-01T14:00:00+09:00",
      },
    ]);
    // a-b は重なる、b-c は重なる → a,b,c いずれも overlap
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  it("開始 == 終了の 0 幅イベントは 無視", () => {
    const result = detectOverlaps([
      {
        id: "a",
        startsAt: "2026-01-01T10:00:00+09:00",
        endsAt: "2026-01-01T10:00:00+09:00",
      },
      {
        id: "b",
        startsAt: "2026-01-01T10:00:00+09:00",
        endsAt: "2026-01-01T11:00:00+09:00",
      },
    ]);
    // a は 0 幅なので intervals に入らない → b 単独 = 重複なし
    expect(result.size).toBe(0);
  });
});

describe("compareByStartTime", () => {
  it("時刻昇順にソート", () => {
    const events = [
      { id: "b", startsAt: "2026-01-01T11:00:00+09:00", endsAt: null },
      { id: "a", startsAt: "2026-01-01T09:00:00+09:00", endsAt: null },
      { id: "c", startsAt: "2026-01-01T14:00:00+09:00", endsAt: null },
    ];
    const sorted = [...events].sort(compareByStartTime);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("時刻を持たないイベントは末尾", () => {
    const events = [
      { id: "no-time", startsAt: "", endsAt: null },
      { id: "with-time", startsAt: "2026-01-01T10:00:00+09:00", endsAt: null },
    ];
    const sorted = [...events].sort(compareByStartTime);
    expect(sorted[0].id).toBe("with-time");
    expect(sorted[1].id).toBe("no-time");
  });
});

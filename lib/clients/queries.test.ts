import { describe, it, expect } from "vitest";
import { aggregateCloseReasons, aggregateEntrySites } from "./queries";

/**
 * クライアント分布集計の純粋関数テスト。
 *
 * UI のサマリカード(失注理由・チャネル別)で使う集計を、DB アクセスから
 * 分離した純粋関数として検証する。
 */

describe("aggregateCloseReasons", () => {
  it("空配列なら空オブジェクト", () => {
    expect(aggregateCloseReasons([])).toEqual({});
  });

  it("非 null の close_reason をカテゴリ別に集計", () => {
    expect(
      aggregateCloseReasons([
        { close_reason: "declined" },
        { close_reason: "completed" },
        { close_reason: "declined" },
        { close_reason: "other_agency" },
        { close_reason: "completed" },
      ]),
    ).toEqual({
      declined: 2,
      completed: 2,
      other_agency: 1,
    });
  });

  it("null は unset にまとめる", () => {
    expect(
      aggregateCloseReasons([
        { close_reason: null },
        { close_reason: null },
        { close_reason: "declined" },
      ]),
    ).toEqual({
      unset: 2,
      declined: 1,
    });
  });

  it('空文字 "" も null と同じ unset 扱い', () => {
    expect(aggregateCloseReasons([{ close_reason: "" }, { close_reason: null }])).toEqual({
      unset: 2,
    });
  });

  it("数値の合計は入力件数と一致(取りこぼしなし)", () => {
    const rows = [
      { close_reason: "declined" },
      { close_reason: null },
      { close_reason: "completed" },
      { close_reason: "" },
      { close_reason: "ineligible" },
    ];
    const result = aggregateCloseReasons(rows);
    const total = Object.values(result).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(rows.length);
  });
});

describe("aggregateEntrySites", () => {
  it("空配列なら空オブジェクト", () => {
    expect(aggregateEntrySites([])).toEqual({});
  });

  it("entry_site 別に集計(大文字小文字は別カテゴリ)", () => {
    expect(
      aggregateEntrySites([
        { entry_site: "リクナビ" },
        { entry_site: "ビズリーチ" },
        { entry_site: "リクナビ" },
        { entry_site: "自社サイト" },
      ]),
    ).toEqual({
      リクナビ: 2,
      ビズリーチ: 1,
      自社サイト: 1,
    });
  });

  it("null / 空文字 / 空白のみは unset にまとめる", () => {
    expect(
      aggregateEntrySites([
        { entry_site: null },
        { entry_site: "" },
        { entry_site: "   " },
        { entry_site: "リクナビ" },
      ]),
    ).toEqual({
      unset: 3,
      リクナビ: 1,
    });
  });

  it("大文字小文字は別カテゴリとして扱う(運用で揃える前提)", () => {
    expect(aggregateEntrySites([{ entry_site: "Recnabi" }, { entry_site: "recnabi" }])).toEqual({
      Recnabi: 1,
      recnabi: 1,
    });
  });

  it("合計は入力件数と一致", () => {
    const rows = [
      { entry_site: "リクナビ" },
      { entry_site: null },
      { entry_site: "ビズリーチ" },
      { entry_site: "" },
      { entry_site: "リクナビ" },
    ];
    const result = aggregateEntrySites(rows);
    const total = Object.values(result).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(rows.length);
  });
});

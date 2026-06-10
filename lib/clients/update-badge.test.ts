import { describe, it, expect } from "vitest";
import { computeHasUnreadUpdate, maxIsoTimestamp } from "./update-badge";

/**
 * 新着・更新バッジ判定の純粋関数テスト。
 *
 * I/O を持たないので素直に値を入れて期待値を見る。判定ルールの境界
 * (両 null / 片方 null / 等時刻 / 前後逆転)を網羅する。
 */

describe("computeHasUnreadUpdate", () => {
  it("本人データが無ければ常に新着にしない(latestUpdatedAt=null)", () => {
    expect(computeHasUnreadUpdate(null, null)).toBe(false);
    expect(computeHasUnreadUpdate(null, "2026-06-10T00:00:00.000Z")).toBe(false);
  });

  it("本人データはあるが一度も見ていなければ新着", () => {
    expect(computeHasUnreadUpdate("2026-06-10T00:00:00.000Z", null)).toBe(true);
  });

  it("最新更新 > 最終閲覧なら新着", () => {
    expect(computeHasUnreadUpdate("2026-06-10T12:00:00.000Z", "2026-06-10T00:00:00.000Z")).toBe(
      true,
    );
  });

  it("最新更新 < 最終閲覧なら新着にしない", () => {
    expect(computeHasUnreadUpdate("2026-06-09T00:00:00.000Z", "2026-06-10T00:00:00.000Z")).toBe(
      false,
    );
  });

  it("同時刻は新着にしない(>= ではなく >)", () => {
    const t = "2026-06-10T00:00:00.000Z";
    expect(computeHasUnreadUpdate(t, t)).toBe(false);
  });
});

describe("maxIsoTimestamp", () => {
  it("全部 null/undefined なら null", () => {
    expect(maxIsoTimestamp([null, undefined, null])).toBeNull();
    expect(maxIsoTimestamp([])).toBeNull();
  });

  it("1 つだけ値があればそれを返す", () => {
    expect(maxIsoTimestamp([null, "2026-06-10T00:00:00.000Z", undefined])).toBe(
      "2026-06-10T00:00:00.000Z",
    );
  });

  it("複数あれば最大(辞書順=時刻順)", () => {
    expect(
      maxIsoTimestamp([
        "2026-06-10T00:00:00.000Z",
        "2026-06-09T23:59:59.999Z",
        "2026-06-10T00:00:01.000Z",
      ]),
    ).toBe("2026-06-10T00:00:01.000Z");
  });

  it("null/undefined 混在でも値だけ評価する", () => {
    expect(
      maxIsoTimestamp([null, "2026-06-10T00:00:00.000Z", undefined, "2026-06-11T00:00:00.000Z"]),
    ).toBe("2026-06-11T00:00:00.000Z");
  });
});

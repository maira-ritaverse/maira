import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HEADER_COLORS,
  defaultSectionLayout,
  loadSectionLayout,
  reorderSectionTo,
  saveSectionLayout,
  sectionsInColumn,
  setSectionColumn,
  setSectionHeaderColor,
  toggleLayoutMode,
} from "./section-order";

// localStorage モック(jsdom 環境ではないので自前で用意)
type LocalStorageLike = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
};

function installLocalStorage(): LocalStorageLike {
  const map = new Map<string, string>();
  const ls: LocalStorageLike = {
    getItem: (k) => (map.has(k) ? (map.get(k) ?? null) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as unknown as { window: { localStorage: LocalStorageLike } }).window = {
    localStorage: ls,
  };
  (globalThis as unknown as { localStorage: LocalStorageLike }).localStorage = ls;
  return ls;
}

const DEFAULT = ["a", "b", "c", "d"];

beforeEach(() => installLocalStorage());
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("defaultSectionLayout", () => {
  it("order はデフォルト通り、mode は 1col、columns は前半 1 / 後半 2", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(l.order).toEqual(DEFAULT);
    expect(l.mode).toBe("1col");
    expect(l.columns).toEqual({ a: 1, b: 1, c: 2, d: 2 });
  });

  it("奇数件は前半が多くなる(ceil 半々)", () => {
    const l = defaultSectionLayout(["a", "b", "c"]);
    expect(l.columns).toEqual({ a: 1, b: 1, c: 2 });
  });
});

describe("reorderSectionTo", () => {
  it("from < to:後ろに移動", () => {
    const l = defaultSectionLayout(DEFAULT);
    const r = reorderSectionTo(l, 0, 2);
    expect(r.order).toEqual(["b", "c", "a", "d"]);
  });
  it("from > to:前に移動", () => {
    const l = defaultSectionLayout(DEFAULT);
    const r = reorderSectionTo(l, 3, 0);
    expect(r.order).toEqual(["d", "a", "b", "c"]);
  });
  it("同じ index は no-op", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(reorderSectionTo(l, 1, 1).order).toEqual(l.order);
  });
  it("範囲外は no-op", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(reorderSectionTo(l, -1, 0).order).toEqual(l.order);
    expect(reorderSectionTo(l, 0, 99).order).toEqual(l.order);
  });
});

describe("HEADER_COLORS / setSectionHeaderColor", () => {
  it("デフォルトレイアウトは全セクションが default 色", () => {
    const l = defaultSectionLayout(DEFAULT);
    DEFAULT.forEach((id) => {
      expect(l.headerColors[id]).toBe("default");
    });
  });
  it("setSectionHeaderColor で色変更", () => {
    const l = defaultSectionLayout(DEFAULT);
    const r = setSectionHeaderColor(l, "a", "blue");
    expect(r.headerColors.a).toBe("blue");
    expect(r.headerColors.b).toBe("default"); // 他は不変
  });
  it("同じ色の再設定は no-op(参照同一)", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(setSectionHeaderColor(l, "a", "default")).toBe(l);
  });
  it("HEADER_COLORS 配列に重複なし + 7 プリセット", () => {
    expect(HEADER_COLORS.length).toBe(7);
    expect(new Set(HEADER_COLORS).size).toBe(HEADER_COLORS.length);
  });
});

describe("setSectionColumn / toggleLayoutMode", () => {
  it("setSectionColumn:既知 ID の column を変更", () => {
    const l = defaultSectionLayout(DEFAULT);
    const r = setSectionColumn(l, "c", 1);
    expect(r.columns.c).toBe(1);
  });
  it("未知 ID は no-op", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(setSectionColumn(l, "unknown", 2)).toEqual(l);
  });
  it("toggleLayoutMode は 1col ↔ 2col を切替", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(toggleLayoutMode(l).mode).toBe("2col");
    expect(toggleLayoutMode(toggleLayoutMode(l)).mode).toBe("1col");
  });
});

describe("sectionsInColumn", () => {
  it("1col モード:column=1 は order 全部、column=2 は空", () => {
    const l = defaultSectionLayout(DEFAULT);
    expect(sectionsInColumn(l, 1)).toEqual(DEFAULT);
    expect(sectionsInColumn(l, 2)).toEqual([]);
  });
  it("2col モード:column 別に order の順序で返す", () => {
    const l = { ...defaultSectionLayout(DEFAULT), mode: "2col" as const };
    expect(sectionsInColumn(l, 1)).toEqual(["a", "b"]);
    expect(sectionsInColumn(l, 2)).toEqual(["c", "d"]);
  });
});

describe("loadSectionLayout / saveSectionLayout", () => {
  it("空 localStorage はデフォルト", () => {
    const l = loadSectionLayout("test-page", DEFAULT);
    expect(l).toEqual(defaultSectionLayout(DEFAULT));
  });
  it("save → load で order / mode / columns / headerColors が保たれる", () => {
    const modified = setSectionHeaderColor(
      reorderSectionTo(
        toggleLayoutMode(setSectionColumn(defaultSectionLayout(DEFAULT), "c", 1)),
        0,
        3,
      ),
      "b",
      "emerald",
    );
    saveSectionLayout("test-page", modified);
    const loaded = loadSectionLayout("test-page", DEFAULT);
    expect(loaded.order).toEqual(modified.order);
    expect(loaded.mode).toBe("2col");
    expect(loaded.columns.c).toBe(1);
    expect(loaded.headerColors.b).toBe("emerald");
  });

  it("不正な color 値は default に倒れる", () => {
    localStorage.setItem(
      "maira:section-layout:v1:test-page",
      JSON.stringify({
        order: DEFAULT,
        columns: {},
        headerColors: { a: "neon-pink" },
        mode: "1col",
      }),
    );
    const loaded = loadSectionLayout("test-page", DEFAULT);
    expect(loaded.headerColors.a).toBe("default");
  });
  it("既知 ID のみ採用、新規 ID(デフォルト追加分)は末尾に補充", () => {
    // 旧:["a","b","c"] で保存された
    saveSectionLayout("test-page", defaultSectionLayout(["a", "b", "c"]));
    // 新:["a","b","c","d"]
    const loaded = loadSectionLayout("test-page", DEFAULT);
    expect(loaded.order).toContain("d");
    expect(loaded.order.indexOf("d")).toBe(loaded.order.length - 1);
  });
  it("不正な JSON はデフォルト", () => {
    localStorage.setItem("maira:section-layout:v1:test-page", "not-json");
    const l = loadSectionLayout("test-page", DEFAULT);
    expect(l).toEqual(defaultSectionLayout(DEFAULT));
  });
});

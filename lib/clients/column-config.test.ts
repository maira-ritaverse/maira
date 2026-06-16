import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ALL_COLUMN_IDS,
  defaultColumnConfig,
  loadColumnConfig,
  moveColumn,
  reorderColumnTo,
  saveColumnConfig,
  toggleColumnVisible,
} from "./column-config";

// vitest はデフォルトでは Node 環境(window/localStorage 無し)。
// 本ファイルは「ブラウザ前提の localStorage 振る舞い」を検証するため、
// グローバル window + localStorage を手動でモックする(本物の jsdom 投入は不要)。
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

let store: LocalStorageLike;
beforeEach(() => {
  store = installLocalStorage();
});
afterEach(() => {
  store.clear();
  // クリーンアップ:globalThis.window を消す
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("defaultColumnConfig", () => {
  it("全列が表示で、定義順に並んでいる", () => {
    const c = defaultColumnConfig();
    expect(c.order).toEqual([...ALL_COLUMN_IDS]);
    expect(c.visible.size).toBe(ALL_COLUMN_IDS.length);
  });
});

describe("loadColumnConfig / saveColumnConfig", () => {
  it("空 localStorage はデフォルトを返す", () => {
    const c = loadColumnConfig();
    expect(c.order).toEqual([...ALL_COLUMN_IDS]);
  });

  it("save → load で並びと非表示状態が保持される", () => {
    const original = defaultColumnConfig();
    const updated = toggleColumnVisible(moveColumn(original, "name", "down"), "email");
    saveColumnConfig(updated);

    const loaded = loadColumnConfig();
    expect(loaded.order[0]).not.toBe("name"); // name が下がっている
    expect(loaded.visible.has("email")).toBe(false);
  });

  it("不正な JSON はデフォルトにフォールバック", () => {
    localStorage.setItem("maira:clients:column-config:v1", "not-json");
    const c = loadColumnConfig();
    expect(c.order).toEqual([...ALL_COLUMN_IDS]);
  });

  it("未知の列 ID は無視される", () => {
    localStorage.setItem(
      "maira:clients:column-config:v1",
      JSON.stringify({ order: ["name", "unknown", "email"], hidden: ["bogus"] }),
    );
    const c = loadColumnConfig();
    expect(c.order).not.toContain("unknown");
    // missing 列は末尾に補充される
    expect(c.order.length).toBe(ALL_COLUMN_IDS.length);
  });

  it("ALL_COLUMN_IDS に追加された新列は末尾に追加 + 表示", () => {
    // 古いユーザの設定:nameKana が無かったときのもの
    const oldOrder = ALL_COLUMN_IDS.filter((id) => id !== "nameKana");
    localStorage.setItem(
      "maira:clients:column-config:v1",
      JSON.stringify({ order: oldOrder, hidden: [] }),
    );
    const c = loadColumnConfig();
    expect(c.order).toContain("nameKana");
    expect(c.order.indexOf("nameKana")).toBe(c.order.length - 1);
    expect(c.visible.has("nameKana")).toBe(true);
  });
});

describe("moveColumn", () => {
  it("name を 1 つ下に動かす", () => {
    const c = defaultColumnConfig();
    const moved = moveColumn(c, "name", "down");
    expect(moved.order[0]).toBe("nameKana");
    expect(moved.order[1]).toBe("name");
  });

  it("先頭で up は no-op", () => {
    const c = defaultColumnConfig();
    expect(moveColumn(c, "name", "up").order).toEqual(c.order);
  });

  it("末尾で down は no-op", () => {
    const c = defaultColumnConfig();
    const last = c.order[c.order.length - 1];
    expect(moveColumn(c, last, "down").order).toEqual(c.order);
  });
});

describe("reorderColumnTo (DnD 用)", () => {
  it("from=0 to=2:先頭の項目が 2 番目位置に移動", () => {
    const c = defaultColumnConfig();
    const moved = reorderColumnTo(c, 0, 2);
    // 元: name, nameKana, email, ...
    // 後: nameKana, email, name, ...
    expect(moved.order[0]).toBe("nameKana");
    expect(moved.order[1]).toBe("email");
    expect(moved.order[2]).toBe("name");
  });

  it("from > to(上に移動):後ろの項目が前に挿入される", () => {
    const c = defaultColumnConfig();
    const moved = reorderColumnTo(c, 3, 0);
    expect(moved.order[0]).toBe(c.order[3]);
    expect(moved.order[1]).toBe(c.order[0]);
  });

  it("from === to は no-op", () => {
    const c = defaultColumnConfig();
    expect(reorderColumnTo(c, 2, 2).order).toEqual(c.order);
  });

  it("範囲外は no-op", () => {
    const c = defaultColumnConfig();
    expect(reorderColumnTo(c, -1, 0).order).toEqual(c.order);
    expect(reorderColumnTo(c, 0, 99).order).toEqual(c.order);
  });

  it("配列長が保たれる(要素消失や重複が無い)", () => {
    const c = defaultColumnConfig();
    const moved = reorderColumnTo(c, 5, 1);
    expect(moved.order.length).toBe(c.order.length);
    expect(new Set(moved.order).size).toBe(c.order.length); // 重複なし
  });
});

describe("toggleColumnVisible", () => {
  it("表示中 → 非表示 → 表示", () => {
    let c = defaultColumnConfig();
    c = toggleColumnVisible(c, "email");
    expect(c.visible.has("email")).toBe(false);
    c = toggleColumnVisible(c, "email");
    expect(c.visible.has("email")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  addGroup,
  deleteGroup,
  hideItem,
  mergeAvailable,
  moveItemToGroup,
  moveItemToTopLevel,
  pruneUnknown,
  renameGroup,
  reorderGroups,
} from "./operations";
import type { ItemDescriptor, SidebarLayout } from "./types";

const ITEMS: ItemDescriptor[] = [
  { id: "a", href: "/a", icon: "🅰", defaultLabel: "A" },
  { id: "b", href: "/b", icon: "🅱", defaultLabel: "B" },
  { id: "c", href: "/c", icon: "🅲", defaultLabel: "C" },
  { id: "d", href: "/d", icon: "🅳", defaultLabel: "D" },
];

function layout(): SidebarLayout {
  return {
    topLevelItemIds: ["a"],
    groups: [
      { id: "g1", title: "G1", itemIds: ["b", "c"] },
      { id: "g2", title: "G2", itemIds: [] },
    ],
    hiddenItemIds: ["d"],
  };
}

describe("moveItemToTopLevel", () => {
  it("グループから item を取り出してトップレベル末尾に追加", () => {
    const l = moveItemToTopLevel(layout(), "b");
    expect(l.topLevelItemIds).toEqual(["a", "b"]);
    expect(l.groups[0].itemIds).toEqual(["c"]);
  });
  it("index 指定で挿入位置を制御", () => {
    const l = moveItemToTopLevel(layout(), "b", 0);
    expect(l.topLevelItemIds).toEqual(["b", "a"]);
  });
  it("hidden からも移動できる(同一不変量)", () => {
    const l = moveItemToTopLevel(layout(), "d");
    expect(l.hiddenItemIds).toEqual([]);
    expect(l.topLevelItemIds).toContain("d");
  });
});

describe("moveItemToGroup", () => {
  it("a(top)を g1 の末尾に移動", () => {
    const l = moveItemToGroup(layout(), "a", "g1");
    expect(l.topLevelItemIds).toEqual([]);
    expect(l.groups[0].itemIds).toEqual(["b", "c", "a"]);
  });
  it("index 指定", () => {
    const l = moveItemToGroup(layout(), "a", "g1", 0);
    expect(l.groups[0].itemIds).toEqual(["a", "b", "c"]);
  });
  it("不明な group は no-op", () => {
    expect(moveItemToGroup(layout(), "a", "unknown")).toEqual(layout());
  });
  it("同一 group 内移動 → 元の位置が剥がれて指定位置に挿入", () => {
    const l = moveItemToGroup(layout(), "b", "g1", 1);
    // b を取り除いて [c] → index=1(末尾)に b 挿入 → [c, b]
    expect(l.groups[0].itemIds).toEqual(["c", "b"]);
  });
});

describe("hideItem", () => {
  it("グループ内 item を非表示に", () => {
    const l = hideItem(layout(), "b");
    expect(l.groups[0].itemIds).toEqual(["c"]);
    expect(l.hiddenItemIds).toEqual(["d", "b"]);
  });
  it("既に非表示なら no-op", () => {
    const l = layout();
    expect(hideItem(l, "d")).toEqual(l);
  });
});

describe("addGroup / renameGroup / deleteGroup", () => {
  it("新規グループを末尾に追加、unique id を生成", () => {
    const l = addGroup(layout(), "新しい");
    expect(l.groups.length).toBe(3);
    expect(l.groups[2].id).toBe("custom-1");
    expect(l.groups[2].title).toBe("新しい");
  });
  it("title 空文字 → fallback", () => {
    const l = addGroup(layout(), "   ");
    expect(l.groups[2].title).toBe("新しいグループ");
  });
  it("rename:title を変える", () => {
    const l = renameGroup(layout(), "g1", "リネーム");
    expect(l.groups[0].title).toBe("リネーム");
  });
  it("rename:空文字は無視(既存値維持)", () => {
    const l = renameGroup(layout(), "g1", "   ");
    expect(l.groups[0].title).toBe("G1");
  });
  it("delete:中の item は topLevel 末尾に逃がす", () => {
    const l = deleteGroup(layout(), "g1");
    expect(l.groups.length).toBe(1);
    expect(l.topLevelItemIds).toEqual(["a", "b", "c"]);
  });
  it("delete:空 group はそのまま消える", () => {
    const l = deleteGroup(layout(), "g2");
    expect(l.groups.length).toBe(1);
  });
});

describe("reorderGroups", () => {
  it("g2 を先頭に", () => {
    const l = reorderGroups(layout(), 1, 0);
    expect(l.groups.map((g) => g.id)).toEqual(["g2", "g1"]);
  });
  it("範囲外は no-op", () => {
    expect(reorderGroups(layout(), 0, 5)).toEqual(layout());
  });
});

describe("mergeAvailable / pruneUnknown", () => {
  it("merge:配置されてない新 item を topLevel 末尾に追加", () => {
    const partial: SidebarLayout = {
      topLevelItemIds: ["a"],
      groups: [],
      hiddenItemIds: [],
    };
    const l = mergeAvailable(partial, ITEMS);
    expect(l.topLevelItemIds).toEqual(["a", "b", "c", "d"]);
  });
  it("merge:既に配置されてれば追加しない", () => {
    const l = mergeAvailable(layout(), ITEMS);
    expect(l).toEqual(layout());
  });
  it("prune:カタログに無い item を全箇所から削除", () => {
    const dirty: SidebarLayout = {
      topLevelItemIds: ["a", "unknown1"],
      groups: [{ id: "g1", title: "G", itemIds: ["b", "unknown2"] }],
      hiddenItemIds: ["d", "unknown3"],
    };
    const l = pruneUnknown(dirty, ITEMS);
    expect(l.topLevelItemIds).toEqual(["a"]);
    expect(l.groups[0].itemIds).toEqual(["b"]);
    expect(l.hiddenItemIds).toEqual(["d"]);
  });
});

describe("不変量:item は 1 箇所だけ", () => {
  function allIds(l: SidebarLayout): string[] {
    return [...l.topLevelItemIds, ...l.groups.flatMap((g) => g.itemIds), ...l.hiddenItemIds];
  }
  it("moveItemToGroup 後も unique", () => {
    const l = moveItemToGroup(layout(), "a", "g1");
    const ids = allIds(l);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("moveItemToTopLevel 後も unique", () => {
    const l = moveItemToTopLevel(layout(), "b");
    const ids = allIds(l);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("hideItem 後も unique", () => {
    const l = hideItem(layout(), "b");
    const ids = allIds(l);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * SidebarLayout に対する純関数操作(全て不変)
 *
 * 設計の不変量:
 *   - 全 itemId は topLevel ∪ groups[*].items ∪ hidden のいずれか 1 箇所だけに居る
 *   - 各操作後にも上記が成り立つ(他の場所からは自動的に取り除く)
 *   - 知らない itemId は捨てる(マイグレーション安全)
 */
import type { GroupDescriptor, ItemDescriptor, SidebarLayout } from "./types";

/** 配列から指定 ID を除去した新配列 */
function without<T extends string>(arr: T[], id: T): T[] {
  return arr.filter((x) => x !== id);
}

/**
 * 「他の場所」に居る itemId を全部取り除いたコピーを返す。
 * 配置先操作の前段で呼ぶ。
 */
function detachItem(layout: SidebarLayout, itemId: string): SidebarLayout {
  return {
    topLevelItemIds: without(layout.topLevelItemIds, itemId),
    groups: layout.groups.map((g) => ({
      ...g,
      itemIds: without(g.itemIds, itemId),
    })),
    hiddenItemIds: without(layout.hiddenItemIds, itemId),
  };
}

/**
 * トップレベルの指定 index に挿入(同 ID が他にあれば先に剥がす)
 */
export function moveItemToTopLevel(
  layout: SidebarLayout,
  itemId: string,
  index?: number,
): SidebarLayout {
  const cleaned = detachItem(layout, itemId);
  const top = [...cleaned.topLevelItemIds];
  const target = index === undefined ? top.length : Math.max(0, Math.min(top.length, index));
  top.splice(target, 0, itemId);
  return { ...cleaned, topLevelItemIds: top };
}

/**
 * 指定グループ内の index に挿入(他の場所からは剥がす)。
 * groupId が無ければ no-op。
 */
export function moveItemToGroup(
  layout: SidebarLayout,
  itemId: string,
  groupId: string,
  index?: number,
): SidebarLayout {
  if (!layout.groups.some((g) => g.id === groupId)) return layout;
  const cleaned = detachItem(layout, itemId);
  const groups = cleaned.groups.map((g) => {
    if (g.id !== groupId) return g;
    const items = [...g.itemIds];
    const target = index === undefined ? items.length : Math.max(0, Math.min(items.length, index));
    items.splice(target, 0, itemId);
    return { ...g, itemIds: items };
  });
  return { ...cleaned, groups };
}

/** 非表示にする(他の場所からは剥がす) */
export function hideItem(layout: SidebarLayout, itemId: string): SidebarLayout {
  if (layout.hiddenItemIds.includes(itemId)) return layout;
  const cleaned = detachItem(layout, itemId);
  return { ...cleaned, hiddenItemIds: [...cleaned.hiddenItemIds, itemId] };
}

/** 新規グループを末尾に追加 */
export function addGroup(layout: SidebarLayout, title: string): SidebarLayout {
  const id = generateGroupId(layout);
  const group: GroupDescriptor = {
    id,
    title: title.trim() || "新しいグループ",
    itemIds: [],
  };
  return { ...layout, groups: [...layout.groups, group] };
}

/** グループ名を変更(空文字は既存値維持) */
export function renameGroup(
  layout: SidebarLayout,
  groupId: string,
  nextTitle: string,
): SidebarLayout {
  const trimmed = nextTitle.trim();
  return {
    ...layout,
    groups: layout.groups.map((g) => (g.id === groupId ? { ...g, title: trimmed || g.title } : g)),
  };
}

/**
 * グループを削除。中の項目はトップレベルの末尾に移す(失われない)。
 */
export function deleteGroup(layout: SidebarLayout, groupId: string): SidebarLayout {
  const group = layout.groups.find((g) => g.id === groupId);
  if (!group) return layout;
  return {
    ...layout,
    groups: layout.groups.filter((g) => g.id !== groupId),
    topLevelItemIds: [...layout.topLevelItemIds, ...group.itemIds],
  };
}

/** グループの並び順を変更 */
export function reorderGroups(layout: SidebarLayout, from: number, to: number): SidebarLayout {
  const len = layout.groups.length;
  if (from === to || from < 0 || from >= len || to < 0 || to >= len) return layout;
  const next = [...layout.groups];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...layout, groups: next };
}

/**
 * `available` のうち、layout で配置されていない項目を全て末尾の topLevel に追加する。
 * カタログに新項目が増えたとき(将来の機能追加)の自動移行に使う。
 */
export function mergeAvailable(
  layout: SidebarLayout,
  available: ReadonlyArray<ItemDescriptor>,
): SidebarLayout {
  const placed = new Set<string>([
    ...layout.topLevelItemIds,
    ...layout.groups.flatMap((g) => g.itemIds),
    ...layout.hiddenItemIds,
  ]);
  const missing = available.filter((a) => !placed.has(a.id)).map((a) => a.id);
  if (missing.length === 0) return layout;
  return { ...layout, topLevelItemIds: [...layout.topLevelItemIds, ...missing] };
}

/**
 * カタログに無くなった項目を layout から取り除く(機能削除時の掃除)。
 */
export function pruneUnknown(
  layout: SidebarLayout,
  available: ReadonlyArray<ItemDescriptor>,
): SidebarLayout {
  const known = new Set(available.map((a) => a.id));
  const keep = (id: string) => known.has(id);
  return {
    topLevelItemIds: layout.topLevelItemIds.filter(keep),
    groups: layout.groups.map((g) => ({ ...g, itemIds: g.itemIds.filter(keep) })),
    hiddenItemIds: layout.hiddenItemIds.filter(keep),
  };
}

/** ユニークな group id 生成(衝突回避) */
function generateGroupId(layout: SidebarLayout): string {
  const existing = new Set(layout.groups.map((g) => g.id));
  let n = 1;
  while (existing.has(`custom-${n}`)) n++;
  return `custom-${n}`;
}

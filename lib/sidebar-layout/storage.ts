/**
 * SidebarLayout の localStorage 永続化(per-page)
 *
 * 不正値は無視してデフォルトにフォールバック。
 * カタログ追加分は mergeAvailable で末尾自動追加、削除分は pruneUnknown で掃除する。
 */
import { mergeAvailable, pruneUnknown } from "./operations";
import type { ItemDescriptor, SidebarLayout } from "./types";

function key(storageKey: string): string {
  return `${storageKey}:v1`;
}

export function loadSidebarLayout(
  storageKey: string,
  defaultLayout: SidebarLayout,
  available: ReadonlyArray<ItemDescriptor>,
): SidebarLayout {
  if (typeof window === "undefined") return defaultLayout;
  let parsed: SidebarLayout | null = null;
  try {
    const raw = localStorage.getItem(key(storageKey));
    if (raw) {
      const obj = JSON.parse(raw) as Partial<SidebarLayout>;
      if (
        Array.isArray(obj.topLevelItemIds) &&
        Array.isArray(obj.groups) &&
        Array.isArray(obj.hiddenItemIds)
      ) {
        parsed = {
          topLevelItemIds: obj.topLevelItemIds.filter((x): x is string => typeof x === "string"),
          // obj.groups は Partial 由来で型がきついため、unknown[] にして手動 narrow
          groups: (obj.groups as unknown[])
            .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
            .map((g) => ({
              id: typeof g.id === "string" ? g.id : `custom-${Date.now()}`,
              title: typeof g.title === "string" ? g.title : "グループ",
              itemIds: Array.isArray(g.itemIds)
                ? (g.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
                : [],
            })),
          hiddenItemIds: obj.hiddenItemIds.filter((x): x is string => typeof x === "string"),
        };
      }
    }
  } catch {
    /* corrupted JSON 等は無視 */
  }
  const base = parsed ?? defaultLayout;
  // 不明 id を捨て、カタログ追加分を末尾に補充
  return mergeAvailable(pruneUnknown(base, available), available);
}

export function saveSidebarLayout(storageKey: string, layout: SidebarLayout): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key(storageKey), JSON.stringify(layout));
  } catch {
    /* private mode 等で保存失敗 */
  }
}

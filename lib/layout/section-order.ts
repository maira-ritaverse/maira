/**
 * セクション単位のレイアウト並び替え基盤
 *
 * 設計:
 *   - 各セクションは sectionId(string)で識別
 *   - レイアウトは「order(並び順)」+「column(1 列 or 2 列モードでの所属)」+「mode(1col/2col)」
 *   - ユーザ設定は localStorage に per-page(storageKey)で保存
 *   - 未保存 / 不正な値はデフォルトにフォールバック
 *   - 新規セクション追加時(ALL_SECTION_IDS が増えた)場合は末尾追加で merge
 *
 * 使い方:
 *   <SectionLayoutContainer
 *     storageKey="agency-client-detail"
 *     defaultOrder={["summary","matching","ai-matching",...]}
 *     sections={{ summary: <SummaryCard/>, matching: <MatchingSection/>, ... }}
 *   />
 */

export type LayoutMode = "1col" | "2col";

/**
 * セクションタイトルの背景色プリセット。
 * UI 側は HEADER_COLOR_CLASS マップで Tailwind クラスに変換する。
 */
export const HEADER_COLORS = [
  "default",
  "blue",
  "emerald",
  "amber",
  "rose",
  "purple",
  "slate",
] as const;
export type HeaderColor = (typeof HEADER_COLORS)[number];

export type SectionLayout = {
  /** 全 sectionId の順番(1col なら左から下、2col なら column 1 → 2 の順) */
  order: string[];
  /** 2col モード時にどの column に表示するか(1 or 2)。1col モードでは無視 */
  columns: Record<string, 1 | 2>;
  /** セクションごとのタイトル背景色(未指定は default) */
  headerColors: Record<string, HeaderColor>;
  mode: LayoutMode;
};

export function defaultSectionLayout(defaultOrder: string[]): SectionLayout {
  const columns: Record<string, 1 | 2> = {};
  const headerColors: Record<string, HeaderColor> = {};
  // デフォルトは「前半 = 列 1、後半 = 列 2」
  const half = Math.ceil(defaultOrder.length / 2);
  defaultOrder.forEach((id, i) => {
    columns[id] = i < half ? 1 : 2;
    headerColors[id] = "default";
  });
  return { order: [...defaultOrder], columns, headerColors, mode: "1col" };
}

function storageKeyFor(page: string): string {
  return `maira:section-layout:v1:${page}`;
}

export function loadSectionLayout(storageKey: string, defaultOrder: string[]): SectionLayout {
  if (typeof window === "undefined") return defaultSectionLayout(defaultOrder);
  try {
    const raw = localStorage.getItem(storageKeyFor(storageKey));
    if (!raw) return defaultSectionLayout(defaultOrder);
    const parsed = JSON.parse(raw) as Partial<SectionLayout>;
    const known = new Set(defaultOrder);

    // order:既知 ID のみ採用 + 未含有を末尾追加
    const order: string[] = Array.isArray(parsed.order)
      ? parsed.order.filter((x): x is string => typeof x === "string" && known.has(x))
      : [];
    for (const id of defaultOrder) if (!order.includes(id)) order.push(id);

    // columns:既知 ID のみ採用、未指定は半々で割り振り
    const columns: Record<string, 1 | 2> = {};
    if (parsed.columns && typeof parsed.columns === "object") {
      for (const [id, col] of Object.entries(parsed.columns)) {
        if (known.has(id) && (col === 1 || col === 2)) columns[id] = col;
      }
    }
    const fallback = defaultSectionLayout(defaultOrder);
    for (const id of defaultOrder) {
      if (!(id in columns)) columns[id] = fallback.columns[id];
    }

    const mode: LayoutMode = parsed.mode === "2col" ? "2col" : "1col";

    // headerColors:既知 ID & 既知プリセット値のみ採用、未指定は default
    const headerColors: Record<string, HeaderColor> = {};
    if (parsed.headerColors && typeof parsed.headerColors === "object") {
      for (const [id, v] of Object.entries(parsed.headerColors)) {
        if (known.has(id) && (HEADER_COLORS as ReadonlyArray<string>).includes(v as string)) {
          headerColors[id] = v as HeaderColor;
        }
      }
    }
    for (const id of defaultOrder) {
      if (!(id in headerColors)) headerColors[id] = "default";
    }

    return { order, columns, headerColors, mode };
  } catch {
    return defaultSectionLayout(defaultOrder);
  }
}

export function saveSectionLayout(storageKey: string, layout: SectionLayout): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKeyFor(storageKey), JSON.stringify(layout));
  } catch {
    // private mode 等で保存失敗しても無視
  }
}

/** DnD:from の位置から to の位置にセクションを移動(order 全体での操作) */
export function reorderSectionTo(layout: SectionLayout, from: number, to: number): SectionLayout {
  const len = layout.order.length;
  if (from === to) return layout;
  if (from < 0 || from >= len || to < 0 || to >= len) return layout;
  const next = [...layout.order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...layout, order: next };
}

/** column 内で sectionId を別 column に移動(2col モード時のみ意味あり) */
export function setSectionColumn(
  layout: SectionLayout,
  sectionId: string,
  column: 1 | 2,
): SectionLayout {
  if (!(sectionId in layout.columns)) return layout;
  if (layout.columns[sectionId] === column) return layout;
  return {
    ...layout,
    columns: { ...layout.columns, [sectionId]: column },
  };
}

/** セクションタイトル背景色を変更 */
export function setSectionHeaderColor(
  layout: SectionLayout,
  sectionId: string,
  color: HeaderColor,
): SectionLayout {
  if (layout.headerColors[sectionId] === color) return layout;
  return {
    ...layout,
    headerColors: { ...layout.headerColors, [sectionId]: color },
  };
}

export function toggleLayoutMode(layout: SectionLayout): SectionLayout {
  return { ...layout, mode: layout.mode === "1col" ? "2col" : "1col" };
}

/** 指定 column に属する section を order の順序で返す */
export function sectionsInColumn(layout: SectionLayout, column: 1 | 2): string[] {
  if (layout.mode === "1col") {
    return column === 1 ? [...layout.order] : [];
  }
  return layout.order.filter((id) => layout.columns[id] === column);
}

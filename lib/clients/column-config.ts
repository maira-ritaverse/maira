/**
 * クライアント一覧テーブルの列設定(並び替え + 表示切替)
 *
 * 設計:
 *   - 全列を ColumnId 型 で列挙
 *   - 各列にデフォルト順序 + 表示状態を持たせる
 *   - ユーザの並び替え結果は localStorage に永続化(per-user / per-browser)
 *   - 並びが破損していたら(列追加 / 不正値)デフォルトにフォールバック
 *
 * 拡張時:
 *   - 新しい列を追加するときは ALL_COLUMN_IDS に追加 + COLUMN_LABELS に表示名
 *   - users が既に保存済みの設定はそのまま読み込まれ、不足する列は末尾に追加
 *   - 削除した列は localStorage から自動で無視される
 */

export const ALL_COLUMN_IDS = [
  "name",
  "nameKana",
  "email",
  "phone",
  "prefecture",
  "employmentType",
  "status",
  "applicationStatus",
  "linkStatus",
  "maStatus",
  "assignee",
  "nextMeeting",
  "receivedAt",
  "createdAt",
] as const;

export type ColumnId = (typeof ALL_COLUMN_IDS)[number];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  name: "氏名",
  nameKana: "氏名カナ",
  email: "メール",
  phone: "電話",
  prefecture: "都道府県",
  employmentType: "雇用形態",
  status: "対応状況",
  applicationStatus: "応募状況",
  linkStatus: "連携",
  maStatus: "MA配信",
  assignee: "担当者",
  nextMeeting: "次の面談",
  receivedAt: "受付日",
  createdAt: "登録日",
};

/** ソート可能な列 — 全列対応(全 ColumnId が SortColumn と一致) */
export const SORTABLE_COLUMNS: ReadonlyArray<ColumnId> = [...ALL_COLUMN_IDS];

export type ColumnConfig = {
  /** 並び順(左 → 右) */
  order: ColumnId[];
  /** 表示する列の集合(ここに無い列は非表示) */
  visible: Set<ColumnId>;
};

const STORAGE_KEY = "maira:clients:column-config:v1";

export function defaultColumnConfig(): ColumnConfig {
  return {
    order: [...ALL_COLUMN_IDS],
    visible: new Set(ALL_COLUMN_IDS),
  };
}

/**
 * 保存済み設定を読み込む。
 * 破損 / 不在 / SSR(window 無し)はデフォルトを返す。
 * 後から ALL_COLUMN_IDS に追加された列は末尾追加 + visible=true で merge する。
 */
export function loadColumnConfig(): ColumnConfig {
  if (typeof window === "undefined") return defaultColumnConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultColumnConfig();
    const parsed = JSON.parse(raw) as { order?: unknown; hidden?: unknown };

    // order の検証:既知 ID のみ採用、未知 ID は黙って除外
    const knownOrder: ColumnId[] = Array.isArray(parsed.order)
      ? parsed.order.filter((x): x is ColumnId =>
          (ALL_COLUMN_IDS as ReadonlyArray<string>).includes(x as string),
        )
      : [];
    // 新規追加された列は末尾に補充
    const missing = ALL_COLUMN_IDS.filter((id) => !knownOrder.includes(id));
    const order = [...knownOrder, ...missing];

    const hiddenArr: ColumnId[] = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((x): x is ColumnId =>
          (ALL_COLUMN_IDS as ReadonlyArray<string>).includes(x as string),
        )
      : [];
    const visible = new Set(ALL_COLUMN_IDS);
    for (const id of hiddenArr) visible.delete(id);

    return { order, visible };
  } catch {
    return defaultColumnConfig();
  }
}

export function saveColumnConfig(config: ColumnConfig): void {
  if (typeof window === "undefined") return;
  try {
    const hidden: ColumnId[] = ALL_COLUMN_IDS.filter((id) => !config.visible.has(id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order: config.order, hidden }));
  } catch {
    // private mode などで保存失敗しても無視
  }
}

export function moveColumn(
  config: ColumnConfig,
  id: ColumnId,
  direction: "up" | "down",
): ColumnConfig {
  const idx = config.order.indexOf(id);
  if (idx < 0) return config;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= config.order.length) return config;
  const next = [...config.order];
  [next[idx], next[target]] = [next[target], next[idx]];
  return { ...config, order: next };
}

/**
 * DnD 用:from の位置から to の位置に列を移動する。
 *
 * - to が from より大きい場合(下に移動):配列から from を取り除いてから to に挿入 → 結果として
 *   元配列での「to の位置に対応する隙間」へ落ちる
 * - to が from より小さい場合(上に移動):同様に削除→挿入で OK
 * - from === to は no-op
 * - 範囲外は no-op
 */
export function reorderColumnTo(config: ColumnConfig, from: number, to: number): ColumnConfig {
  const len = config.order.length;
  if (from === to) return config;
  if (from < 0 || from >= len || to < 0 || to >= len) return config;
  const next = [...config.order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...config, order: next };
}

export function toggleColumnVisible(config: ColumnConfig, id: ColumnId): ColumnConfig {
  const visible = new Set(config.visible);
  if (visible.has(id)) visible.delete(id);
  else visible.add(id);
  return { ...config, visible };
}

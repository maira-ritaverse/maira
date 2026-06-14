/**
 * クライアント一覧の絞り込み + 並び替えの純関数。
 *
 * ClientsTable コンポーネントから抽出し、副作用ゼロでテスト可能に。
 * 検索・ステータス・エントリーサイトの 3 軸絞り込みと、3 列ソートをサポート。
 *
 * 設計方針:
 *   - 入力配列は破壊しない(slice してから sort)
 *   - 部分一致検索は大文字小文字を無視(toLowerCase 比較)
 *   - エントリーサイトの "unset" は entrySite が null / 空 / 空白のみのレコードに一致
 *   - 名前ソートは "ja" ロケールで自然順(漢字 / かな / カナ混在に対応)
 */

import type { ClientEmploymentType, ClientStatus } from "./types";

export type SortColumn = "name" | "status" | "createdAt";
export type SortDirection = "asc" | "desc";
export type StatusFilter = ClientStatus | "all";

/**
 * 絞り込み + 並び替えに必要な最小フィールド。
 *
 * EMPRO 拡張(マイグレーション 20260615100001)で nameKana / prefecture /
 * currentEmploymentType の 3 フィールドを追加した。検索 / 絞り込みのキーになる
 * ため、ここに含める。テスト fixture も追従。
 */
export type ClientForFilterSort = {
  name: string;
  email: string;
  status: ClientStatus;
  createdAt: string;
  entrySite: string | null;
  // EMPRO 拡張
  nameKana: string | null;
  prefecture: string | null;
  currentEmploymentType: ClientEmploymentType | null;
};

export type FilterSortOptions = {
  searchQuery: string;
  statusFilter: StatusFilter;
  /** "all" は絞らない、"unset" は entrySite が null/空/空白扱い、その他は完全一致 */
  entrySiteFilter: string;
  /** EMPRO 拡張:"all" は絞らない、"unset" は prefecture が null/空、その他は完全一致 */
  prefectureFilter: string;
  /** EMPRO 拡張:"all" は絞らない、"unset" は null、その他は ClientEmploymentType の値で完全一致 */
  employmentTypeFilter: string;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
};

/**
 * entrySite を「絞り込みキー」に正規化する。null / 空 / 空白のみは "unset"。
 * ここを純関数化することで、entrySiteOptions(件数集計)とフィルタ判定で
 * 同じキー導出ロジックを共有できる。
 */
export function normalizeEntrySiteKey(entrySite: string | null | undefined): string {
  if (!entrySite || entrySite.trim() === "") return "unset";
  return entrySite;
}

/**
 * 都道府県 / 雇用形態 のフィルタキー正規化(entrySite と同じパターン)。
 * null / 空白 は "unset"、それ以外は値そのまま。
 */
function normalizeNullableKey(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "unset";
  return value;
}

export function applyClientsFilterSort<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
  opts: FilterSortOptions,
): T[] {
  let result: ReadonlyArray<T> = clients;

  // 検索(氏名 / 氏名カナ / メールに部分一致、大文字小文字無視)。
  // 氏名カナは null 可なので存在確認してから includes。
  // 五十音検索が EMPRO 名簿の標準なので、name_kana も検索対象に含める。
  const q = opts.searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.email.toLowerCase().includes(q)) return true;
      if (c.nameKana && c.nameKana.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // ステータス絞り込み
  if (opts.statusFilter !== "all") {
    result = result.filter((c) => c.status === opts.statusFilter);
  }

  // エントリーサイト絞り込み("unset" は null/空/空白)
  if (opts.entrySiteFilter !== "all") {
    result = result.filter((c) => normalizeEntrySiteKey(c.entrySite) === opts.entrySiteFilter);
  }

  // 都道府県絞り込み(EMPRO 拡張)
  if (opts.prefectureFilter !== "all") {
    result = result.filter((c) => normalizeNullableKey(c.prefecture) === opts.prefectureFilter);
  }

  // 雇用形態絞り込み(EMPRO 拡張)
  if (opts.employmentTypeFilter !== "all") {
    result = result.filter(
      (c) => normalizeNullableKey(c.currentEmploymentType) === opts.employmentTypeFilter,
    );
  }

  // ソート(immutable: 元配列を破壊しないため slice してから sort)
  const sorted = result.slice().sort((a, b) => {
    let cmp = 0;
    if (opts.sortColumn === "name") {
      // 日本語の自然順でソート(漢字/かな対応)
      cmp = a.name.localeCompare(b.name, "ja");
    } else if (opts.sortColumn === "status") {
      cmp = a.status.localeCompare(b.status);
    } else {
      cmp = a.createdAt.localeCompare(b.createdAt);
    }
    return opts.sortDirection === "asc" ? cmp : -cmp;
  });

  return sorted;
}

/**
 * 「現在の clients から実在するエントリーサイトを件数降順で並べたオプション配列」を返す。
 * UI のセレクトボックスに使う(空エントリ・件数 0 のオプションを出さないため)。
 * entrySite の正規化(unset 扱い)は normalizeEntrySiteKey と共有。
 */
export function buildEntrySiteOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const key = normalizeEntrySiteKey(c.entrySite);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * 都道府県のオプション配列(EMPRO 拡張、entrySite と同じパターン)。
 * 件数降順で並べる。null/空 は "unset" にまとめる。
 */
export function buildPrefectureOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const key = normalizeNullableKey(c.prefecture);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * 雇用形態のオプション配列(EMPRO 拡張)。
 * 件数降順。null は "unset"。値は ClientEmploymentType の enum 値。
 */
export function buildEmploymentTypeOptions<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const key = normalizeNullableKey(c.currentEmploymentType);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

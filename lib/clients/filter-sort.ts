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

import type { ClientStatus } from "./types";

export type SortColumn = "name" | "status" | "createdAt";
export type SortDirection = "asc" | "desc";
export type StatusFilter = ClientStatus | "all";

/**
 * 絞り込み + 並び替えに必要な最小フィールド。
 *
 * ClientRecordWithUpdateBadge は extra プロパティが大量にあるが、
 * この関数が読むのは下記 5 つだけ。テスト用の fixture も最小で済む。
 */
export type ClientForFilterSort = {
  name: string;
  email: string;
  status: ClientStatus;
  createdAt: string;
  entrySite: string | null;
};

export type FilterSortOptions = {
  searchQuery: string;
  statusFilter: StatusFilter;
  /** "all" は絞らない、"unset" は entrySite が null/空/空白扱い、その他は完全一致 */
  entrySiteFilter: string;
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

export function applyClientsFilterSort<T extends ClientForFilterSort>(
  clients: ReadonlyArray<T>,
  opts: FilterSortOptions,
): T[] {
  let result: ReadonlyArray<T> = clients;

  // 検索(氏名 or メールに部分一致、大文字小文字無視)
  const q = opts.searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }

  // ステータス絞り込み
  if (opts.statusFilter !== "all") {
    result = result.filter((c) => c.status === opts.statusFilter);
  }

  // エントリーサイト絞り込み("unset" は null/空/空白)
  if (opts.entrySiteFilter !== "all") {
    result = result.filter((c) => normalizeEntrySiteKey(c.entrySite) === opts.entrySiteFilter);
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

/**
 * 求人一覧のフィルタ + ソート(純関数、副作用ゼロ)
 *
 * クライアント一覧の filter-sort と同じパターン:UI 側で状態を持ち、
 * 純関数で結果配列を返す。検索・ステータス・勤務地・年収帯で絞り込み可能。
 */

import { type JobStatus } from "./types";

export type JobSortColumn = "company" | "position" | "createdAt" | "salary";
export type JobSortDirection = "asc" | "desc";
export type JobStatusFilter = JobStatus | "all";

/** フィルタ / ソートに必要な最小フィールド(JobPosting の Pick 派生) */
export type JobForFilterSort = {
  id: string;
  companyName: string;
  position: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  employmentType: string | null;
  createdAt: string;
};

export type JobFilterSortOptions = {
  searchQuery: string;
  statusFilter: JobStatusFilter;
  /** 勤務地の部分一致(空文字は絞らない) */
  locationKeyword: string;
  /** 年収「下限」(万円)。0 / undefined は絞らない */
  minSalary?: number;
  /** 年収「上限」(万円)。0 / undefined は絞らない */
  maxSalary?: number;
  sortColumn: JobSortColumn;
  sortDirection: JobSortDirection;
};

function normalizeForSearch(s: string): string {
  return s.trim().normalize("NFKC").toLowerCase();
}

/**
 * 求人レンジと検索レンジが重なるかチェック。
 * - 求人側の min/max いずれかが null なら片側を無限として扱う。
 * - 検索側の min/max いずれかが undefined / 0 は無視。
 */
function salaryRangeOverlaps(
  jobMin: number | null,
  jobMax: number | null,
  searchMin: number | undefined,
  searchMax: number | undefined,
): boolean {
  // 検索側が未指定なら絞らない
  if (!searchMin && !searchMax) return true;
  // 求人の上限が検索の下限を下回っていれば不一致(求人上限 < 検索下限)
  if (searchMin && jobMax !== null && jobMax < searchMin) return false;
  // 求人の下限が検索の上限を上回っていれば不一致(求人下限 > 検索上限)
  if (searchMax && jobMin !== null && jobMin > searchMax) return false;
  return true;
}

export function applyJobsFilterSort<T extends JobForFilterSort>(
  jobs: ReadonlyArray<T>,
  opts: JobFilterSortOptions,
): T[] {
  let result: ReadonlyArray<T> = jobs;

  const q = normalizeForSearch(opts.searchQuery);
  if (q) {
    result = result.filter((j) => {
      if (normalizeForSearch(j.companyName).includes(q)) return true;
      if (normalizeForSearch(j.position).includes(q)) return true;
      if (j.location && normalizeForSearch(j.location).includes(q)) return true;
      return false;
    });
  }

  if (opts.statusFilter !== "all") {
    result = result.filter((j) => j.status === opts.statusFilter);
  }

  const locKw = normalizeForSearch(opts.locationKeyword);
  if (locKw) {
    result = result.filter(
      (j) => j.location !== null && normalizeForSearch(j.location).includes(locKw),
    );
  }

  if (opts.minSalary || opts.maxSalary) {
    result = result.filter((j) =>
      salaryRangeOverlaps(j.salaryMin, j.salaryMax, opts.minSalary, opts.maxSalary),
    );
  }

  // ソート(immutable)
  const sorted = result.slice().sort((a, b) => {
    let cmp = 0;
    if (opts.sortColumn === "company") {
      cmp = a.companyName.localeCompare(b.companyName, "ja");
    } else if (opts.sortColumn === "position") {
      cmp = a.position.localeCompare(b.position, "ja");
    } else if (opts.sortColumn === "salary") {
      // 上限を基準にソート(null は最小値として扱う)
      const av = a.salaryMax ?? -1;
      const bv = b.salaryMax ?? -1;
      cmp = av - bv;
    } else {
      cmp = a.createdAt.localeCompare(b.createdAt);
    }
    return opts.sortDirection === "asc" ? cmp : -cmp;
  });

  return sorted;
}

/**
 * 一覧から「実在する勤務地キーワード」をユニーク化(件数降順)。
 * フリーテキスト(東京都港区)の集計なので、UI の datalist 候補で使う。
 */
export function buildJobLocationOptions<T extends JobForFilterSort>(
  jobs: ReadonlyArray<T>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const j of jobs) {
    if (!j.location) continue;
    const k = j.location.trim();
    if (k === "") continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

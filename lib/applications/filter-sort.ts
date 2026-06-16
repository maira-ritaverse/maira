/**
 * 応募一覧のフィルタ + ソート(純関数)
 *
 * クライアント / ジョブの filter-sort と同じパターン:UI 側で状態を持ち、
 * 純関数で結果配列を返す。検索・ステータス・期限状態でフィルタ可。
 *
 * 期限状態(due):
 *   - "any" 絞らない
 *   - "overdue" next_action_at が現在 < 過去
 *   - "soon" next_action_at が 7 日以内
 *   - "none" next_action_at が未設定
 */
import { applicationStatuses, type ApplicationStatus } from "./types";

export type AppStatusFilter = ApplicationStatus | "all";
export type AppDueFilter = "any" | "overdue" | "soon" | "none";
export type AppSortColumn = "createdAt" | "nextActionAt" | "company" | "appliedAt";
export type AppSortDirection = "asc" | "desc";

export type ApplicationForFilterSort = {
  id: string;
  details: { company: string; position: string };
  status: ApplicationStatus;
  applied_at: string | null;
  next_action_at: string | null;
  created_at: string;
};

export type AppFilterSortOptions = {
  searchQuery: string;
  statusFilter: AppStatusFilter;
  dueFilter: AppDueFilter;
  /** 沈黙/期限判定の現在時刻(epoch ms)。dueFilter "any"/"none" 以外で必要。 */
  now?: number;
  sortColumn: AppSortColumn;
  sortDirection: AppSortDirection;
};

function normalizeForSearch(s: string): string {
  return s.trim().normalize("NFKC").toLowerCase();
}

const SOON_THRESHOLD_DAYS = 7;

export function applyApplicationsFilterSort<T extends ApplicationForFilterSort>(
  apps: ReadonlyArray<T>,
  opts: AppFilterSortOptions,
): T[] {
  let result: ReadonlyArray<T> = apps;

  // 検索:会社名 / 職種
  const q = normalizeForSearch(opts.searchQuery);
  if (q) {
    result = result.filter((a) => {
      if (normalizeForSearch(a.details.company).includes(q)) return true;
      if (normalizeForSearch(a.details.position).includes(q)) return true;
      return false;
    });
  }

  // ステータス
  if (opts.statusFilter !== "all") {
    result = result.filter((a) => a.status === opts.statusFilter);
  }

  // 期限状態
  if (opts.dueFilter !== "any") {
    if (opts.dueFilter === "none") {
      result = result.filter((a) => a.next_action_at === null);
    } else {
      // 期限あり判定:next_action_at がある + 現在比
      if (opts.now !== undefined) {
        const SOON_MS = SOON_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
        result = result.filter((a) => {
          if (!a.next_action_at) return false;
          const t = Date.parse(a.next_action_at);
          if (Number.isNaN(t)) return false;
          if (opts.dueFilter === "overdue") return t < opts.now!;
          if (opts.dueFilter === "soon") {
            const diff = t - opts.now!;
            return diff >= 0 && diff < SOON_MS;
          }
          return true;
        });
      }
    }
  }

  // ソート
  const sorted = result.slice().sort((a, b) => {
    let cmp = 0;
    if (opts.sortColumn === "company") {
      cmp = a.details.company.localeCompare(b.details.company, "ja");
    } else if (opts.sortColumn === "nextActionAt") {
      const av = a.next_action_at ?? "9999-12-31";
      const bv = b.next_action_at ?? "9999-12-31";
      cmp = av.localeCompare(bv);
    } else if (opts.sortColumn === "appliedAt") {
      const av = a.applied_at ?? "0000-01-01";
      const bv = b.applied_at ?? "0000-01-01";
      cmp = av.localeCompare(bv);
    } else {
      cmp = a.created_at.localeCompare(b.created_at);
    }
    return opts.sortDirection === "asc" ? cmp : -cmp;
  });

  return sorted;
}

/** ステータス別件数の集計(ダッシュボード用) */
export function summarizeByStatus<T extends ApplicationForFilterSort>(
  apps: ReadonlyArray<T>,
): Record<ApplicationStatus, number> {
  const result = Object.fromEntries(applicationStatuses.map((s) => [s, 0])) as Record<
    ApplicationStatus,
    number
  >;
  for (const a of apps) {
    if (result[a.status] !== undefined) result[a.status] += 1;
  }
  return result;
}

/** 期限切れ + 間近の件数を集計 */
export function summarizeDue<T extends ApplicationForFilterSort>(
  apps: ReadonlyArray<T>,
  now: number,
): { overdue: number; soon: number; none: number; total: number } {
  const SOON_MS = SOON_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  let overdue = 0;
  let soon = 0;
  let none = 0;
  for (const a of apps) {
    if (!a.next_action_at) {
      none += 1;
      continue;
    }
    const t = Date.parse(a.next_action_at);
    if (Number.isNaN(t)) continue;
    if (t < now) overdue += 1;
    else if (t - now < SOON_MS) soon += 1;
  }
  return { overdue, soon, none, total: apps.length };
}

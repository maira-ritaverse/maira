"use client";

import { Handshake } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNow } from "@/lib/agency-tasks/use-now";
import {
  applicationStatuses,
  applicationStatusLabels,
  type Application,
  type ApplicationStatus,
} from "@/lib/applications/types";
import {
  applyApplicationsFilterSort,
  summarizeByStatus,
  summarizeDue,
  type AppDueFilter,
  type AppSortColumn,
  type AppSortDirection,
  type AppStatusFilter,
} from "@/lib/applications/filter-sort";

type Props = {
  applications: Application[];
};

const SORT_LABELS: Record<AppSortColumn, string> = {
  createdAt: "登録日",
  nextActionAt: "次アクション期限",
  appliedAt: "応募日",
  company: "会社名",
};

/**
 * 応募管理一覧(検索 / フィルタ / サマリ + ソート)
 *
 * 既存はサーバ側で status クエリパラメータでだけ絞っていたが、
 * 件数が増えると不便なので、検索 / 期限フィルタ / サマリ表示を加える。
 */
export function ApplicationsListClient({ applications }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AppStatusFilter>("all");
  const [dueFilter, setDueFilter] = useState<AppDueFilter>("any");
  const [sortColumn, setSortColumn] = useState<AppSortColumn>("createdAt");
  const [sortDirection, setSortDirection] = useState<AppSortDirection>("desc");

  const now = useNow();
  const nowMs = now ? now.getTime() : undefined;

  const filtered = useMemo(
    () =>
      applyApplicationsFilterSort(applications, {
        searchQuery,
        statusFilter,
        dueFilter,
        now: nowMs,
        sortColumn,
        sortDirection,
      }),
    [applications, searchQuery, statusFilter, dueFilter, nowMs, sortColumn, sortDirection],
  );

  const statusSummary = useMemo(() => summarizeByStatus(applications), [applications]);
  const dueSummary = useMemo(
    () => (nowMs ? summarizeDue(applications, nowMs) : { overdue: 0, soon: 0, none: 0, total: 0 }),
    [applications, nowMs],
  );

  const toggleSort = (col: AppSortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

  return (
    <div className="space-y-4">
      {/* サマリカード(全期間の集計) */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <SummaryChip label="期限切れ" value={dueSummary.overdue} tone="red" />
        <SummaryChip label="7日以内" value={dueSummary.soon} tone="amber" />
        <SummaryChip label="期限なし" value={dueSummary.none} tone="muted" />
        <SummaryChip label="合計" value={applications.length} tone="neutral" />
      </div>

      {/* フィルタ行 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="会社名・職種で検索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-xs"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AppStatusFilter)}
            className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
          >
            <option value="all">すべてのステータス({applications.length})</option>
            {applicationStatuses.map((s) => (
              <option key={s} value={s}>
                {applicationStatusLabels[s as ApplicationStatus]}({statusSummary[s]})
              </option>
            ))}
          </select>
          <select
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value as AppDueFilter)}
            className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
          >
            <option value="any">期限すべて</option>
            <option value="overdue">期限切れ({dueSummary.overdue})</option>
            <option value="soon">7日以内({dueSummary.soon})</option>
            <option value="none">期限なし({dueSummary.none})</option>
          </select>
          <span className="text-muted-foreground text-sm">{filtered.length}件</span>
        </div>
        {/* ソート */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
          並び替え:
          {(Object.keys(SORT_LABELS) as AppSortColumn[]).map((col) => (
            <button
              key={col}
              type="button"
              onClick={() => toggleSort(col)}
              className="hover:bg-accent rounded px-2 py-0.5"
            >
              {SORT_LABELS[col]}
              {sortColumn === col ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">該当する応募がありません</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => {
            const dueBadge = getDueBadge(app.next_action_at, nowMs);
            return (
              <Card key={app.id} className="p-0">
                <Link
                  href={`/app/applications/${app.id}`}
                  className="hover:bg-accent block p-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{app.details.company}</p>
                        <span className="bg-muted rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                          {applicationStatusLabels[app.status]}
                        </span>
                        {/* エージェント経由で /app/agent-referrals から「追加」された行は notes に
                            「○○エージェント 経由」が含まれる。ローカル管理と区別するためのバッジ。 */}
                        {app.details.notes?.includes("経由") && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] whitespace-nowrap text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            <Handshake className="size-2.5" aria-hidden />
                            エージェント経由
                          </span>
                        )}
                        {dueBadge && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap ${dueBadge.cls}`}
                          >
                            {dueBadge.text}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1 truncate text-sm">
                        {app.details.position}
                      </p>
                      {app.next_action_at && (
                        <p className="text-muted-foreground mt-2 text-xs">
                          次のアクション期限:
                          {new Date(app.next_action_at).toLocaleString("ja-JP")}
                        </p>
                      )}
                    </div>
                    <span className="text-muted-foreground text-sm">→</span>
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getDueBadge(
  nextActionAt: string | null,
  now: number | undefined,
): { text: string; cls: string } | null {
  if (!nextActionAt || !now) return null;
  const t = Date.parse(nextActionAt);
  if (Number.isNaN(t)) return null;
  const diff = t - now;
  const DAY = 24 * 60 * 60 * 1000;
  if (diff < 0)
    return {
      text: "期限切れ",
      cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    };
  if (diff < 7 * DAY)
    return {
      text: "7日以内",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    };
  return null;
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "amber" | "muted" | "neutral";
}) {
  const cls =
    tone === "red"
      ? "bg-red-50 ring-red-200 dark:bg-red-950/30 dark:ring-red-900"
      : tone === "amber"
        ? "bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900"
        : tone === "muted"
          ? "bg-muted/30"
          : "ring-foreground/10";
  return (
    <div className={`space-y-0.5 rounded-md p-2 ring-1 ${cls}`}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

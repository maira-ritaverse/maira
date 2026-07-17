"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NlSearchBar, type NlSearchChip } from "@/components/features/search/nl-search-bar";
import type { JobSearchFilters } from "@/lib/search/nl-parse-schema";
import {
  formatSalaryRange,
  jobStatusLabels,
  countLabourFieldsFilled,
  LABOUR_FIELDS_TOTAL,
  type JobPosting,
  type JobStatus,
} from "@/lib/jobs/types";
import {
  applyJobsFilterSort,
  buildJobLocationOptions,
  type JobFilterSortOptions,
  type JobStatusFilter,
  type JobSortColumn,
  type JobSortDirection,
} from "@/lib/jobs/filter-sort";

type Props = {
  jobs: JobPosting[];
};

// ステータス タブ に 表示 する 順序 (募集中 → 停止中 → 終了)。
// 「すべて」 タブ は 意図 的 に 出さない (要件: 3 分類 で フォルダ 分け)。
const STATUS_TABS: JobStatus[] = ["open", "paused", "closed"];

export function JobsListClient({ jobs }: Props) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  // 既定 タブ = 「募集中」。 停止中 / 終了 の 求人 は 通常 見せず、 タブ で 明示 的 に
  // 切り替えて もらう 運用 に する (エージェント の 日常 業務 は 募集中 中心)。
  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>("open");
  const [locationKeyword, setLocationKeyword] = useState("");
  const [minSalary, setMinSalary] = useState<string>("");
  const [maxSalary, setMaxSalary] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<JobSortColumn>("createdAt");
  const [sortDirection, setSortDirection] = useState<JobSortDirection>("desc");
  // 一括選択 + アクション
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<JobStatus>("open");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const locationOptions = useMemo(() => buildJobLocationOptions(jobs), [jobs]);

  // タブ の 件数 バッジ 用: ステータス 別 の 全体 件数 (検索 / 勤務地 / 年収 の
  // 絞込 を 加味 しない)。 「今 どこ に 何 件 あるか」 を 常時 見せた 方 が 探し
  // やすい ため、 タブ ラベル は 絞込 と 独立 に 集計 する。
  const statusCounts = useMemo(() => {
    const counts: Record<JobStatus, number> = { open: 0, paused: 0, closed: 0 };
    for (const j of jobs) counts[j.status]++;
    return counts;
  }, [jobs]);

  const opts: JobFilterSortOptions = useMemo(
    () => ({
      searchQuery,
      statusFilter,
      locationKeyword,
      minSalary: minSalary === "" ? undefined : Number(minSalary),
      maxSalary: maxSalary === "" ? undefined : Number(maxSalary),
      sortColumn,
      sortDirection,
    }),
    [searchQuery, statusFilter, locationKeyword, minSalary, maxSalary, sortColumn, sortDirection],
  );

  const filtered = useMemo(() => applyJobsFilterSort(jobs, opts), [jobs, opts]);

  const toggleSort = (col: JobSortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };
  const arrow = (col: JobSortColumn): string =>
    sortColumn !== col ? "" : sortDirection === "asc" ? " ↑" : " ↓";

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((j) => selectedIds.has(j.id));

  const submitBulkStatus = async () => {
    if (selectedIds.size === 0) return;
    setBulkSubmitting(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/agency/jobs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_status",
          ids: Array.from(selectedIds),
          status: bulkStatus,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSelectedIds(new Set());
      router.refresh();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setBulkSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* フィルタ行 */}
      <div className="space-y-2">
        {/* AI 検索バー (トグル OFF が既定、ON にすると自然文を Claude が構造化する) */}
        <NlSearchBar<JobSearchFilters>
          resource="jobs"
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          placeholder="会社名・職種・勤務地・スキル・本文で検索"
          aiPlaceholder="例: 年収 500 万以上でリモートワーク可の Web エンジニア"
          currentFilters={{
            searchQuery,
            statusFilter,
            locationKeyword,
            minSalary: minSalary === "" ? null : Number(minSalary),
            maxSalary: maxSalary === "" ? null : Number(maxSalary),
            remainingText: "",
            confidence: "high",
          }}
          onApplyAiFilters={(f) => {
            // AI が返した各フィールドを個別 setState に展開。
            // remainingText は searchQuery にマージして自由検索へ流す。
            const mergedQuery = [f.searchQuery, f.remainingText]
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
              .join(" ");
            setSearchQuery(mergedQuery);
            setStatusFilter(f.statusFilter);
            setLocationKeyword(f.locationKeyword);
            setMinSalary(f.minSalary === null ? "" : String(f.minSalary));
            setMaxSalary(f.maxSalary === null ? "" : String(f.maxSalary));
          }}
          renderChips={(f) => {
            const chips: NlSearchChip[] = [];
            if (f.searchQuery && f.searchQuery.trim().length > 0) {
              chips.push({
                key: "q",
                label: `キーワード: ${f.searchQuery}`,
                onRemove: () => setSearchQuery(""),
              });
            }
            // ステータス は タブ UI で 常に 表示 されて いる ので chip で 重複表示 しない。
            // AI が statusFilter を 変えた 場合 は 上部 の タブ の active 状態 が
            // 切り替わる ため、 chip なし でも 何が 起きた か 分かる。
            if (f.locationKeyword.trim().length > 0) {
              chips.push({
                key: "loc",
                label: `勤務地: ${f.locationKeyword}`,
                onRemove: () => setLocationKeyword(""),
              });
            }
            if (f.minSalary !== null) {
              chips.push({
                key: "smin",
                label: `年収: ${f.minSalary} 万以上`,
                onRemove: () => setMinSalary(""),
              });
            }
            if (f.maxSalary !== null) {
              chips.push({
                key: "smax",
                label: `年収: ${f.maxSalary} 万以下`,
                onRemove: () => setMaxSalary(""),
              });
            }
            return chips;
          }}
        />
        {/* ステータス タブ (募集中 / 停止中 / 終了)。
            AI 検索 が statusFilter="all" を 返す 可能性 は 残る が、 その 場合 は
            どの タブ も active に なら ない (全 件 表示 の 状態)。 通常 導線 は タブ
            クリック で 明示 的 に 選択 する。 */}
        <div
          role="tablist"
          aria-label="求人 の ステータス"
          className="border-border flex items-center gap-1 border-b"
        >
          {STATUS_TABS.map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(s)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                {jobStatusLabels[s]}
                <span
                  className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs ${
                    active ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {statusCounts[s]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            list="job-locations"
            placeholder="勤務地で絞り込み"
            value={locationKeyword}
            onChange={(e) => setLocationKeyword(e.target.value)}
            className="border-input bg-background w-40 rounded-lg border px-3 py-1.5 text-sm"
          />
          <datalist id="job-locations">
            {locationOptions.map(([loc]) => (
              <option key={loc} value={loc} />
            ))}
          </datalist>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              placeholder="年収下限"
              value={minSalary}
              onChange={(e) => setMinSalary(e.target.value)}
              className="w-24"
            />
            <span className="text-muted-foreground text-xs">〜</span>
            <Input
              type="number"
              placeholder="上限"
              value={maxSalary}
              onChange={(e) => setMaxSalary(e.target.value)}
              className="w-24"
            />
            <span className="text-muted-foreground text-xs">万円</span>
          </div>
          <span className="text-muted-foreground text-sm">{filtered.length}件</span>
        </div>
        {/* ソートボタン */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
          並び替え:
          <button
            type="button"
            onClick={() => toggleSort("createdAt")}
            className="hover:bg-accent rounded px-2 py-0.5"
          >
            登録日{arrow("createdAt")}
          </button>
          <button
            type="button"
            onClick={() => toggleSort("company")}
            className="hover:bg-accent rounded px-2 py-0.5"
          >
            会社名{arrow("company")}
          </button>
          <button
            type="button"
            onClick={() => toggleSort("position")}
            className="hover:bg-accent rounded px-2 py-0.5"
          >
            職種{arrow("position")}
          </button>
          <button
            type="button"
            onClick={() => toggleSort("salary")}
            className="hover:bg-accent rounded px-2 py-0.5"
          >
            年収{arrow("salary")}
          </button>
        </div>
      </div>

      {/* 全選択 + 一括バー */}
      {filtered.length > 0 && (
        <div className="ring-foreground/10 flex flex-wrap items-center gap-2 rounded-md p-2 ring-1">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el) {
                  el.indeterminate =
                    !allFilteredSelected && filtered.some((j) => selectedIds.has(j.id));
                }
              }}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    for (const j of filtered) next.add(j.id);
                    return next;
                  });
                } else {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    for (const j of filtered) next.delete(j.id);
                    return next;
                  });
                }
              }}
            />
            全選択
          </label>
          <span className="text-muted-foreground text-xs">{selectedIds.size} 件選択中</span>
          {selectedIds.size > 0 && (
            <>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as JobStatus)}
                className="border-input bg-background rounded-lg border px-2 py-1 text-xs"
              >
                {Object.entries(jobStatusLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={submitBulkStatus} disabled={bulkSubmitting}>
                {bulkSubmitting ? "適用中…" : `${selectedIds.size} 件に適用`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                選択解除
              </Button>
              {bulkError && (
                <span className="text-xs text-red-600 dark:text-red-300">{bulkError}</span>
              )}
            </>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">該当する求人がありません</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((job) => (
            <Card
              key={job.id}
              className={`p-0 ${selectedIds.has(job.id) ? "ring-primary/50 ring-2" : ""}`}
            >
              <div className="flex items-center gap-2 p-4">
                <input
                  type="checkbox"
                  checked={selectedIds.has(job.id)}
                  onChange={() => toggleSelectId(job.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`${job.companyName} を選択`}
                />
                <Link
                  href={`/agency/jobs/${job.id}`}
                  className="hover:bg-accent flex flex-1 items-center justify-between gap-4 rounded-md transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{job.companyName}</p>
                    <p className="text-muted-foreground truncate text-sm">
                      {job.position}
                      {job.location ? ` ・ ${job.location}` : ""}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {formatSalaryRange(job.salaryMin, job.salaryMax)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <LabourBadge filled={countLabourFieldsFilled(job)} />
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        job.status === "open"
                          ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                          : job.status === "paused"
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {jobStatusLabels[job.status]}
                    </span>
                  </div>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LabourBadge({ filled }: { filled: number }) {
  const total = LABOUR_FIELDS_TOTAL;
  const colorClass =
    filled === total
      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
      : filled === 0
        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${colorClass}`}
      title="法定明示事項(2024年改正労基法対応 8 項目)の入力進捗"
    >
      法定 {filled}/{total}
    </span>
  );
}

"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import type { ActivityEvent, ActivityEventColor } from "@/lib/clients/activity-timeline";

type ActivityTimelineSectionProps = {
  events: ActivityEvent[];
};

// バッジ用の Tailwind クラス。ActivityEventColor を 1:1 でクラスに変換する。
// インライン文字列補間ではなくマップにすることで Tailwind の purge を信頼できる。
const COLOR_BADGE: Record<ActivityEventColor, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

// 縦線(timeline rail)を彩るドット色。背景はカードと同じトーンに揃える。
const COLOR_DOT: Record<ActivityEventColor, string> = {
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  green: "bg-emerald-500",
  red: "bg-red-500",
  gray: "bg-gray-400",
  slate: "bg-slate-400",
};

const INITIAL_VISIBLE = 8;

/**
 * クライアント活動タイムラインセクション(詳細画面の上部寄せに配置)。
 *
 * 「対応 / タスク / 応募 / 選考遷移 / 連携状態」の全イベントを 1 本の時系列に
 * まとめて見せる。CRM の 360° ビューに相当。
 *
 * 表示方針:
 *   - 初期は INITIAL_VISIBLE 件のみ。「もっと見る」で全件展開。
 *   - 縦のレールに沿ってドット + カードを並べる。
 *   - フィルタチップで kind を切り替え(対応 / タスク / 応募 / 連携 / すべて)。
 *   - 0 件のときは EmptyState ライクな案内。
 */
export function ActivityTimelineSection({ events }: ActivityTimelineSectionProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => filterEvents(events, filter), [events, filter]);
  const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">活動タイムライン</h2>
        <span className="text-muted-foreground text-xs tabular-nums">{filtered.length}件</span>
      </div>

      {/* フィルタチップ */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_CHIPS.map((chip) => {
          const isActive = filter === chip.key;
          const count = countEvents(events, chip.key);
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => {
                setFilter(chip.key);
                setExpanded(false);
              }}
              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {chip.label}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          まだ活動の記録がありません
        </div>
      ) : (
        <>
          <ol className="border-muted-foreground/20 relative space-y-4 border-l-2 pl-6">
            {visible.map((event) => (
              <TimelineItem key={event.id} event={event} />
            ))}
          </ol>

          {filtered.length > INITIAL_VISIBLE && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              >
                {expanded ? `折りたたむ` : `さらに ${filtered.length - INITIAL_VISIBLE} 件を見る`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function TimelineItem({ event }: { event: ActivityEvent }) {
  return (
    <li className="relative">
      {/* レールから生えるドット。pl-6 + left-[-1.6rem] の組み合わせでレール上に乗せる */}
      <span
        className={`absolute top-1 left-[-1.7rem] inline-block size-3 rounded-full ring-2 ring-white dark:ring-zinc-900 ${COLOR_DOT[event.color]}`}
        aria-hidden
      />
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${COLOR_BADGE[event.color]}`}
        >
          {event.badgeLabel}
        </span>
        <span className="text-sm font-medium">{event.title}</span>
      </div>
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="whitespace-nowrap">{formatDateTime(event.occurredAt)}</span>
        {event.actorName && (
          <>
            <span aria-hidden>·</span>
            <span>{event.actorName}</span>
          </>
        )}
      </div>
      {event.detail && (
        <p className="text-muted-foreground mt-1.5 line-clamp-3 text-xs whitespace-pre-wrap">
          {event.detail}
        </p>
      )}
    </li>
  );
}

type FilterKey = "all" | "interaction" | "task" | "referral" | "link";

const FILTER_CHIPS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "すべて" },
  { key: "interaction", label: "対応" },
  { key: "task", label: "タスク" },
  { key: "referral", label: "応募" },
  { key: "link", label: "連携" },
];

function matchFilter(event: ActivityEvent, key: FilterKey): boolean {
  if (key === "all") return true;
  if (key === "interaction") return event.kind === "interaction";
  if (key === "task") return event.kind === "task_created" || event.kind === "task_completed";
  if (key === "referral")
    return event.kind === "referral_created" || event.kind === "referral_status_changed";
  if (key === "link")
    return (
      event.kind === "client_linked" ||
      event.kind === "client_revoke_requested" ||
      event.kind === "client_revoked"
    );
  return false;
}

function filterEvents(events: ActivityEvent[], key: FilterKey): ActivityEvent[] {
  if (key === "all") return events;
  return events.filter((e) => matchFilter(e, key));
}

function countEvents(events: ActivityEvent[], key: FilterKey): number {
  if (key === "all") return events.length;
  let c = 0;
  for (const e of events) if (matchFilter(e, key)) c += 1;
  return c;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

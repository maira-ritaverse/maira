"use client";

import { AlertTriangle, Clock, ExternalLink, Mic, X } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDialog } from "@/lib/ui/use-dialog";
import type { CalendarEvent } from "@/lib/calendar/types";

/**
 * 特定の日のイベント全件を時刻順に表示するダイアログ。
 * 月ビューの「+N件」リンク(従来は /agency/clients?silence=all という誤導線だった)
 * を置き換え、その日のすべての予定を透過的に確認できるようにする。
 *
 * 実装: useDialog hook (Esc / focus trap / body scroll lock 対応) + Card レイアウト。
 * shadcn の Dialog は本プロジェクトでは未導入のため、GoogleEventDialog と同じ
 * 構造で統一。
 */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateKey: string; // "YYYY-MM-DD"
  events: CalendarEvent[];
  /** 衝突している event.id の集合。表示時に赤バッジを付ける。 */
  overlappingIds: Set<string>;
  kindLabel: Record<string, string>;
  kindTone: Record<string, string>;
  /** イベントクリック時のハンドラ (親側で遷移 / ダイアログ制御) */
  onEventClick: (ev: CalendarEvent) => void;
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "終日";
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDateHeader(dateKey: string): string {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function DayEventsDialog({
  open,
  onOpenChange,
  dateKey,
  events,
  overlappingIds,
  kindLabel,
  kindTone,
  onEventClick,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(open, () => onOpenChange(false), dialogRef);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => onOpenChange(false)}
    >
      <Card
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-events-dialog-title"
        className="w-full max-w-lg space-y-3 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="day-events-dialog-title" className="text-base font-semibold">
            {formatDateHeader(dateKey)} の予定 ({events.length}件)
          </h2>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} aria-label="閉じる">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {events.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">予定がありません</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {events.map((ev) => {
              const conflict = overlappingIds.has(ev.id);
              // M5: 会議 kind に 録音 状態 バッジ を 追加。
              const recState = ev.kind === "meeting" ? ev.recordingState : null;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onEventClick(ev);
                      onOpenChange(false);
                    }}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900 ${
                      conflict ? "ring-2 ring-red-500" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${
                          kindTone[ev.kind] ?? "bg-slate-100"
                        }`}
                      >
                        {kindLabel[ev.kind] ?? ev.kind}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" />
                        {formatTime(ev.occurredAt)}
                        {ev.endsAt && ` - ${formatTime(ev.endsAt)}`}
                      </span>
                      {recState === "recorded" && (
                        <span className="flex items-center gap-0.5 text-[10px] text-emerald-700">
                          <Mic className="h-3 w-3" />
                          録音済
                        </span>
                      )}
                      {recState === "planned" && (
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                          <Mic className="h-3 w-3" />
                          録音予定
                        </span>
                      )}
                      {conflict && (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-red-600">
                          <AlertTriangle className="h-3 w-3" />
                          時刻衝突
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">
                      {ev.kind === "external_google" ? ev.title : `${ev.clientName}: ${ev.title}`}
                    </p>
                    {ev.joinUrl && (
                      <span className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-[10px]">
                        <ExternalLink className="h-2.5 w-2.5" />
                        Web 面談 URL あり
                      </span>
                    )}
                    {ev.clientRecordId && (
                      <Link
                        href={`/agency/clients/${ev.clientRecordId}`}
                        className="text-muted-foreground mt-0.5 block truncate text-[10px] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        顧客詳細 →
                      </Link>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

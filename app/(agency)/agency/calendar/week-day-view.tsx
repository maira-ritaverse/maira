"use client";

/**
 * 週 / 日ビュー (時間軸タイムライン)。
 *
 * 差別化のコア (M1):
 *   ・月ビューでは分刻みの重複や隙間が見えず、面談スロットの詰め込み判断が
 *     不可能。 週 / 日ビューで 30 分単位の粒度を見せる。
 *   ・時刻を持たないイベント (first_meeting, intake) は上部の「終日帯」に集約。
 *   ・重複はイベント側で既に detectOverlaps 済み → props.overlappingIds を
 *     受けて赤リング表示。
 *
 * 描画レンジ: 6:00 - 23:00 (17 時間 × 60 min / 30 min = 34 スロット)。
 * 1 スロット = 24 px 縦 = 30 分。 1 時間 = 48 px。
 */

import { AlertTriangle, Mic } from "lucide-react";
import { useMemo } from "react";

import type { CalendarEvent, CalendarEventKind } from "@/lib/calendar/types";

const HOUR_START = 6;
const HOUR_END = 23;
const PX_PER_MIN = 24 / 30; // 24 px = 30 min = 0.8 px/min
const TOTAL_MIN = (HOUR_END - HOUR_START) * 60; // 1020 min = 816 px

type WeekDayViewProps = {
  /** "week" なら 7 列、 "day" なら 1 列。 aria-label 用。 */
  mode: "week" | "day";
  /** week: 日曜始まりの週開始 YYYY-MM-DD / day: 該当日 YYYY-MM-DD */
  columns: Array<{ dateKey: string; label: string; isToday: boolean }>;
  /** dateKey → CalendarEvent[] */
  eventsByDate: Map<string, CalendarEvent[]>;
  overlappingIds: Set<string>;
  kindLabel: Record<string, string>;
  kindTone: Record<string, string>;
  onEventClick: (ev: CalendarEvent) => void;
};

/** ISO → その日 0 時からの分数 (時刻無し = null) */
function minutesFromMidnight(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * イベントの top / height を計算。
 * clamp: 描画レンジ外は端に丸める (上/下)。
 * default height: endsAt 無しの meeting は 30 分。
 */
function computeBar(ev: CalendarEvent): { topPx: number; heightPx: number } | null {
  const startMin = minutesFromMidnight(ev.occurredAt);
  if (startMin === null) return null;
  const endMin = ev.endsAt ? minutesFromMidnight(ev.endsAt) : startMin + 30;
  if (endMin === null) return null;

  const rangeStartMin = HOUR_START * 60;
  const rangeEndMin = HOUR_END * 60;
  const s = Math.max(startMin, rangeStartMin);
  const e = Math.min(endMin, rangeEndMin);
  if (e <= s) return null;

  return {
    topPx: (s - rangeStartMin) * PX_PER_MIN,
    heightPx: Math.max(18, (e - s) * PX_PER_MIN), // 最小 18px (視認性)
  };
}

export function WeekDayView({
  mode,
  columns,
  eventsByDate,
  overlappingIds,
  kindLabel,
  kindTone,
  onEventClick,
}: WeekDayViewProps) {
  // 各列で「時刻あり」「時刻無し (終日帯)」に分割
  const columnData = useMemo(() => {
    return columns.map((col) => {
      const evs = eventsByDate.get(col.dateKey) ?? [];
      const timed: CalendarEvent[] = [];
      const allday: CalendarEvent[] = [];
      for (const ev of evs) {
        if (ev.occurredAt) timed.push(ev);
        else allday.push(ev);
      }
      return { ...col, timed, allday };
    });
  }, [columns, eventsByDate]);

  const hourRows = useMemo(() => {
    const rows: number[] = [];
    for (let h = HOUR_START; h <= HOUR_END; h++) rows.push(h);
    return rows;
  }, []);

  return (
    <div
      className="overflow-x-auto"
      role="region"
      aria-label={mode === "week" ? "週ビュー タイムライン" : "日ビュー タイムライン"}
    >
      <div
        className="grid gap-px"
        style={{
          gridTemplateColumns: `48px repeat(${columnData.length}, minmax(120px, 1fr))`,
        }}
      >
        {/* ヘッダ行: 空セル + 列ラベル */}
        <div className="bg-muted/40" />
        {columnData.map((col) => (
          <div
            key={col.dateKey}
            className={`bg-muted/40 px-2 py-1 text-center text-xs font-medium ${
              col.isToday ? "text-primary" : ""
            }`}
          >
            {col.label}
          </div>
        ))}

        {/* 終日帯: 時刻無しイベント (first_meeting / intake / task_due の時刻無し) */}
        <div className="bg-background text-muted-foreground flex items-start justify-end pt-0.5 pr-1 text-[10px]">
          終日
        </div>
        {columnData.map((col) => (
          <div
            key={`allday-${col.dateKey}`}
            className={`bg-background ring-foreground/5 min-h-6 space-y-0.5 p-1 ring-1 ring-inset ${
              col.isToday ? "ring-primary/30" : ""
            }`}
          >
            {col.allday.map((ev) => {
              const conflict = overlappingIds.has(ev.id);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onEventClick(ev)}
                  className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] ${
                    kindTone[ev.kind as CalendarEventKind] ?? "bg-slate-100"
                  } hover:opacity-80 ${conflict ? "ring-1 ring-red-500" : ""}`}
                  title={`${kindLabel[ev.kind] ?? ev.kind}: ${ev.clientName} — ${ev.title}`}
                >
                  {conflict && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-red-600" />}
                  <span className="truncate">
                    {ev.kind === "external_google" ? ev.title : `${ev.clientName}:${ev.title}`}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        {/* 時間軸: 左端は 時刻ラベル、各列は relative container 内でイベントを絶対配置 */}
        <div
          className="bg-background text-muted-foreground text-[10px]"
          style={{ height: TOTAL_MIN * PX_PER_MIN }}
        >
          {hourRows.map((h) => (
            <div key={h} className="flex justify-end pr-1" style={{ height: 48 }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {columnData.map((col) => (
          <div
            key={`col-${col.dateKey}`}
            className={`bg-background ring-foreground/5 relative ring-1 ring-inset ${
              col.isToday ? "ring-primary/30" : ""
            }`}
            style={{ height: TOTAL_MIN * PX_PER_MIN }}
          >
            {/* 1 時間ごとの区切り線 */}
            {hourRows.map((h, i) => (
              <div
                key={h}
                className="border-foreground/5 absolute inset-x-0 border-t"
                style={{ top: i * 48 }}
              />
            ))}

            {/* 時刻ありイベント */}
            {col.timed.map((ev) => {
              const bar = computeBar(ev);
              if (!bar) return null;
              const conflict = overlappingIds.has(ev.id);
              const recState = ev.kind === "meeting" ? ev.recordingState : null;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onEventClick(ev)}
                  className={`absolute right-0.5 left-0.5 flex flex-col items-start gap-0.5 overflow-hidden rounded border p-1 text-left text-[10px] ${
                    kindTone[ev.kind as CalendarEventKind] ?? "bg-slate-100"
                  } hover:opacity-80 ${conflict ? "ring-2 ring-red-500" : ""}`}
                  style={{ top: bar.topPx, height: bar.heightPx }}
                  title={`${kindLabel[ev.kind] ?? ev.kind}: ${ev.clientName} — ${ev.title}${
                    conflict ? " (時刻衝突)" : ""
                  }`}
                >
                  <div className="flex w-full items-center gap-0.5">
                    {conflict && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-red-600" />}
                    {recState === "recorded" && (
                      <Mic className="h-2.5 w-2.5 shrink-0 text-emerald-700" aria-label="録音済" />
                    )}
                    {recState === "planned" && (
                      <Mic className="h-2.5 w-2.5 shrink-0 text-amber-600" aria-label="録音予定" />
                    )}
                    <span className="truncate font-medium">
                      {ev.kind === "external_google" ? ev.title : ev.clientName}
                    </span>
                  </div>
                  {bar.heightPx >= 32 && (
                    <span className="truncate text-[9px] opacity-70">{ev.title}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

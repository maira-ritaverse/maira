"use client";

import { AlertTriangle, Mic } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { compareByStartTime, detectOverlaps } from "@/lib/calendar/overlap";
import type { CalendarEvent, CalendarEventKind } from "@/lib/calendar/types";

import { DayEventsDialog } from "./day-events-dialog";
import { GoogleEventDialog } from "./google-event-dialog";

type CalendarViewProps = {
  /** 初期表示の月(YYYY-MM)。サーバー側で「現在月」を渡す。 */
  initialMonth: string;
  /** 初期月のイベント。月切替時はクライアントから再フェッチする。 */
  initialEvents: CalendarEvent[];
};

const KIND_LABEL: Record<CalendarEventKind, string> = {
  first_meeting: "面談",
  intake: "受付",
  task_due: "タスク",
  interaction: "対応",
  meeting: "Web面談",
  company_interview: "企業面接",
  external_google: "Google",
};

const KIND_TONE: Record<CalendarEventKind, string> = {
  first_meeting: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  intake: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  task_due: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  interaction: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  meeting: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  company_interview: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  external_google: "bg-sky-100/70 text-sky-700/80 dark:bg-sky-950/60 dark:text-sky-300/80",
};

const WEEK_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 月表示のカレンダー。
 *
 * 表示は (年月) 単位。月切替で /api/agency/calendar?month=YYYY-MM を fetch。
 * 各セルは 6 行 × 7 列のグリッド。当月外の日は薄く表示。
 * セル内の各イベントは色 + ラベル + クライアント名のチップで描画。
 * クリックで該当クライアントの詳細ページへ遷移。
 *
 * 注意:
 *   - Date.now() を直接呼ばないように、initialMonth はサーバーから受け取る。
 *   - クライアント側で月切替後、現在時刻に対する週ハイライトは表示しない
 *     (時刻ドリフトを気にしないシンプル方針)。
 */
type GoogleApiEvent = {
  id: string;
  externalEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  dateKey: string;
  joinUrl: string | null;
  organizerName: string;
};

type DialogState =
  | { open: false }
  | { open: true; mode: "edit"; initial: GoogleApiEvent }
  | { open: true; mode: "new"; dateKey: string };

export function CalendarView({ initialMonth, initialEvents }: CalendarViewProps) {
  const router = useRouter();
  const [yearMonth, setYearMonth] = useState<string>(initialMonth);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [googleEvents, setGoogleEvents] = useState<GoogleApiEvent[]>([]);
  /** Google 連携の状態(初回 fetch までは null) */
  const [googleStatus, setGoogleStatus] = useState<
    "connected" | "not_connected" | "scope_insufficient" | "error" | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // kind フィルタ:何も選ばれていない = 全表示。
  const [activeKinds, setActiveKinds] = useState<Set<CalendarEventKind>>(new Set());
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  // Q1: DayEventsDialog の state。 従来 の 「+N件」 デッド リンク の 置き換え。
  const [dayDialog, setDayDialog] = useState<{ open: boolean; dateKey: string }>({
    open: false,
    dateKey: "",
  });

  // Google 由来イベントを CalendarEvent 形にマージ(useMemo)
  const allEvents = useMemo<CalendarEvent[]>(() => {
    const ge: CalendarEvent[] = googleEvents.map((g) => ({
      id: g.id,
      kind: "external_google" as const,
      dateKey: g.dateKey,
      occurredAt: g.startsAt,
      title: g.title,
      clientRecordId: null,
      clientName: g.organizerName || "Google",
      externalEventId: g.externalEventId,
      joinUrl: g.joinUrl ?? undefined,
      endsAt: g.endsAt,
    }));
    return [...events, ...ge];
  }, [events, googleEvents]);

  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of allEvents) {
      if (activeKinds.size > 0 && !activeKinds.has(ev.kind)) continue;
      const arr = m.get(ev.dateKey) ?? [];
      arr.push(ev);
      m.set(ev.dateKey, arr);
    }
    // 各日のイベントを時刻順にソート。 時刻無しは末尾。
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        compareByStartTime(
          { id: a.id, startsAt: a.occurredAt ?? "", endsAt: a.endsAt ?? null },
          { id: b.id, startsAt: b.occurredAt ?? "", endsAt: b.endsAt ?? null },
        ),
      );
    }
    return m;
  }, [allEvents, activeKinds]);

  // Q1: 全イベントの時刻重複を検出 (グループキーなし = 同一 org 内の Double-book を全体で判定)。
  // 将来 M1 で担当者別 groupKey を渡す拡張を予定。
  const overlappingIds = useMemo(() => {
    return detectOverlaps(
      allEvents
        .filter((ev) => ev.occurredAt !== null)
        .map((ev) => ({
          id: ev.id,
          startsAt: ev.occurredAt as string,
          endsAt: ev.endsAt ?? null,
        })),
    );
  }, [allEvents]);

  const monthCells = useMemo(() => buildMonthCells(yearMonth), [yearMonth]);

  // イベントクリック時の共通ハンドラ。セル内のチップと DayEventsDialog から共有。
  const handleEventClick = useCallback(
    (ev: CalendarEvent) => {
      // Google 由来 → 編集ダイアログを開く
      if (ev.kind === "external_google" && ev.externalEventId) {
        const g = googleEvents.find((x) => x.externalEventId === ev.externalEventId);
        if (g) setDialog({ open: true, mode: "edit", initial: g });
        return;
      }
      // M5: 会議 (meeting) で 録音 済 or 予定 が ある なら、 顧客 詳細 の 録音
      // セクション に アンカー 付き で 遷移。 顧客 未紐付け の 場合 は 通常 の
      // meeting 挙動 (URL / clients ページ) に fallback。
      if (ev.kind === "meeting" && ev.clientRecordId && ev.recordingState) {
        router.push(`/agency/clients/${ev.clientRecordId}#intake-recordings`);
        return;
      }
      // Maira クライアント有り → クライアント詳細へ
      if (ev.clientRecordId) {
        router.push(`/agency/clients/${ev.clientRecordId}`);
        return;
      }
      // Web 面談で URL があれば参加
      if (ev.joinUrl) {
        window.open(ev.joinUrl, "_blank", "noopener,noreferrer");
      }
    },
    [googleEvents, router],
  );

  const monthRange = useCallback((ym: string): { from: string; to: string } => {
    const [y, m] = ym.split("-").map(Number);
    const start = new Date(y, m - 1, 1 - 7);
    const end = new Date(y, m, 7);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);

  const fetchGoogleEvents = useCallback(
    async (ym: string) => {
      const { from, to } = monthRange(ym);
      try {
        const res = await fetch(
          `/api/me/google-calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        );
        if (!res.ok) {
          setGoogleStatus("error");
          setGoogleEvents([]);
          return;
        }
        const json = (await res.json()) as {
          events?: GoogleApiEvent[];
          notConnected?: boolean;
          scopeInsufficient?: boolean;
        };
        if (json.notConnected) {
          setGoogleStatus("not_connected");
          setGoogleEvents([]);
          return;
        }
        if (json.scopeInsufficient) {
          setGoogleStatus("scope_insufficient");
          setGoogleEvents([]);
          return;
        }
        setGoogleStatus("connected");
        setGoogleEvents(json.events ?? []);
      } catch {
        setGoogleStatus("error");
        setGoogleEvents([]);
      }
    },
    [monthRange],
  );

  // 初回マウント時に Google を遅延フェッチ
  // (SSR では Google API を叩かない方針:不要なレイテンシ・OAuth 失効時の SSR 失敗回避)
  // 月切替時は navigate() 内で並行 fetch するので、ここでは初回だけでよい。
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    void fetchGoogleEvents(yearMonth);
  }, [fetchGoogleEvents, yearMonth]);

  const navigate = async (delta: number) => {
    const next = shiftMonth(yearMonth, delta);
    setYearMonth(next);
    setLoading(true);
    setError(null);
    try {
      const [mairaRes] = await Promise.all([
        fetch(`/api/agency/calendar?month=${next}`),
        fetchGoogleEvents(next),
      ]);
      if (!mairaRes.ok) throw new Error(`HTTP ${mairaRes.status}`);
      const json = (await mairaRes.json()) as { events: CalendarEvent[] };
      setEvents(json.events ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setError(`イベント取得失敗: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    await fetchGoogleEvents(yearMonth);
  };

  const toggleKind = (kind: CalendarEventKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <Card className="space-y-4 p-5">
      {/* ヘッダ:月切替 + フィルタ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => navigate(-1)} disabled={loading}>
            ← 前月
          </Button>
          <h2 className="px-3 text-lg font-semibold tabular-nums">{formatMonth(yearMonth)}</h2>
          <Button size="sm" variant="outline" onClick={() => navigate(1)} disabled={loading}>
            翌月 →
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">表示:</span>
          {(Object.keys(KIND_LABEL) as CalendarEventKind[]).map((k) => {
            const isActive = activeKinds.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : `${KIND_TONE[k]} hover:opacity-80`
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            );
          })}
          {activeKinds.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveKinds(new Set())}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              クリア
            </button>
          )}
        </div>
        {loading && <span className="text-muted-foreground text-xs">読み込み中…</span>}
        {error && <span className="text-xs text-red-600 dark:text-red-300">{error}</span>}

        <div className="ml-auto flex items-center gap-2">
          {googleStatus === "connected" && (
            <Button
              size="sm"
              onClick={() => {
                const today = new Date();
                const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                setDialog({ open: true, mode: "new", dateKey });
              }}
            >
              + Google に予定を追加
            </Button>
          )}
          {googleStatus === "not_connected" && (
            <Link
              href="/agency/settings/integrations"
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              Google カレンダーを連携
            </Link>
          )}
          {googleStatus === "scope_insufficient" && (
            <Link
              href="/agency/settings/integrations"
              className="text-xs text-amber-600 underline-offset-4 hover:underline dark:text-amber-300"
            >
              Google を再認可してください
            </Link>
          )}
          {googleStatus === "error" && (
            <span className="text-muted-foreground text-xs">Google 予定の取得に失敗</span>
          )}
        </div>
      </div>

      {/* 曜日ラベル */}
      <div className="grid grid-cols-7 gap-px text-xs">
        {WEEK_LABELS.map((wk, i) => (
          <div
            key={wk}
            className={`bg-muted/40 px-2 py-1 text-center font-medium ${
              i === 0 ? "text-red-600" : i === 6 ? "text-blue-600" : ""
            }`}
          >
            {wk}
          </div>
        ))}
      </div>

      {/* Google イベント編集 / 新規作成ダイアログ */}
      {dialog.open && (
        <GoogleEventDialog
          open={dialog.open}
          onClose={() => setDialog({ open: false })}
          initial={dialog.mode === "edit" ? dialog.initial : null}
          initialDateKey={dialog.mode === "new" ? dialog.dateKey : undefined}
          onChanged={refresh}
        />
      )}

      {/* Q1: 「+N件」 クリック で 当日 の 全イベント を 時刻順表示 */}
      <DayEventsDialog
        open={dayDialog.open}
        onOpenChange={(open) => setDayDialog((prev) => ({ ...prev, open }))}
        dateKey={dayDialog.dateKey}
        events={eventsByDate.get(dayDialog.dateKey) ?? []}
        overlappingIds={overlappingIds}
        kindLabel={KIND_LABEL}
        kindTone={KIND_TONE}
        onEventClick={handleEventClick}
      />

      {/* 月グリッド(6 週 = 42 セル) */}
      <div className="grid grid-cols-7 gap-px">
        {monthCells.map((cell) => {
          const eventsOfDay = eventsByDate.get(cell.dateKey) ?? [];
          return (
            <div
              key={cell.dateKey}
              className={`bg-background group ring-foreground/5 min-h-20 space-y-1 p-1.5 ring-1 ring-inset ${
                cell.inMonth ? "" : "text-muted-foreground/50 bg-muted/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs tabular-nums">{cell.day}</div>
                {googleStatus === "connected" && (
                  <button
                    type="button"
                    onClick={() => setDialog({ open: true, mode: "new", dateKey: cell.dateKey })}
                    className="text-muted-foreground/40 hover:text-foreground hidden text-xs leading-none group-hover:inline"
                    aria-label="この日に予定を追加"
                    title="Google カレンダーに予定を追加"
                  >
                    +
                  </button>
                )}
              </div>
              {eventsOfDay.slice(0, 4).map((ev) => {
                const conflict = overlappingIds.has(ev.id);
                // M5: 録音 状態 に 応じて mic アイコン を 添える (meeting kind のみ)。
                //   ・recorded → 緑 mic (アップロード 済、 クリック で 詳細 へ)
                //   ・planned → アンバー mic (予定 のみ、 未 アップロード の 催促)
                const recState = ev.kind === "meeting" ? ev.recordingState : null;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => handleEventClick(ev)}
                    className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] ${
                      KIND_TONE[ev.kind]
                    } hover:opacity-80 ${conflict ? "ring-1 ring-red-500" : ""}`}
                    title={`${KIND_LABEL[ev.kind]}: ${ev.clientName} — ${ev.title}${
                      conflict ? " (時刻衝突)" : ""
                    }${
                      recState === "recorded"
                        ? " (録音 済)"
                        : recState === "planned"
                          ? " (録音 予定)"
                          : ""
                    }`}
                  >
                    {conflict && <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-red-600" />}
                    {recState === "recorded" && (
                      <Mic className="h-2.5 w-2.5 shrink-0 text-emerald-700" aria-label="録音済" />
                    )}
                    {recState === "planned" && (
                      <Mic className="h-2.5 w-2.5 shrink-0 text-amber-600" aria-label="録音予定" />
                    )}
                    <span className="truncate">
                      {ev.kind === "external_google" ? ev.title : `${ev.clientName}:${ev.title}`}
                    </span>
                  </button>
                );
              })}
              {eventsOfDay.length > 4 && (
                <button
                  type="button"
                  onClick={() => setDayDialog({ open: true, dateKey: cell.dateKey })}
                  className="text-muted-foreground hover:text-foreground text-[10px] underline-offset-4 hover:underline"
                >
                  +{eventsOfDay.length - 4}件
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────
// 純粋ヘルパ(Date.now を呼ばない、副作用ゼロ)
// ────────────────────────────────────────────

type MonthCell = { dateKey: string; day: number; inMonth: boolean };

/** YYYY-MM を翌月 / 前月にシフト(delta = ±1) */
function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const next = new Date(y, m - 1 + delta, 1);
  const ny = next.getFullYear();
  const nm = next.getMonth() + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** 6 週 × 7 = 42 セルの月グリッドを返す。日曜始まり。 */
function buildMonthCells(yearMonth: string): MonthCell[] {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return [];
  const first = new Date(y, m - 1, 1);
  const startWeekday = first.getDay(); // 0=日, 6=土
  // グリッド開始は当月 1 日の同週の日曜
  const gridStart = new Date(y, m - 1, 1 - startWeekday);
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({
      dateKey,
      day: d.getDate(),
      inMonth: d.getMonth() === m - 1,
    });
  }
  return cells;
}

function formatMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

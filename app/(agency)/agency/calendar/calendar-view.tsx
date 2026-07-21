"use client";

import { AlertTriangle, Mic } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { compareByStartTime, detectOverlaps } from "@/lib/calendar/overlap";
import { formatPeriodLabel, getWeekRange, shiftAnchor, type ViewMode } from "@/lib/calendar/period";
import type { CalendarEvent, CalendarEventKind } from "@/lib/calendar/types";

import { DayEventsDialog } from "./day-events-dialog";
import { GoogleEventDialog } from "./google-event-dialog";
import { ManualMeetingDialog } from "./manual-meeting-dialog";
import { WeekDayView } from "./week-day-view";

type ClientOption = { id: string; name: string };

type CalendarViewProps = {
  /** 初期表示の月(YYYY-MM)。サーバー側で「現在月」を渡す。 */
  initialMonth: string;
  /** 初期アンカー日 (YYYY-MM-DD)。 M1 週 / 日ビューの中心日として使う。 */
  initialAnchorDate: string;
  /** 初期月のイベント。月切替時はクライアントから再フェッチする。 */
  initialEvents: CalendarEvent[];
  /** #5b: 手動 会議 予定 作成 ダイアログ の 顧客 セレクタ 用 */
  clientOptions: ClientOption[];
};

const KIND_LABEL: Record<CalendarEventKind, string> = {
  first_meeting: "面談",
  intake: "受付",
  task_due: "タスク",
  interaction: "対応",
  meeting: "Web面談",
  meeting_tentative: "候補",
  company_interview: "企業面接",
  interview_round: "面接",
  offer_deadline: "回答期限",
  external_google: "Google",
};

const KIND_TONE: Record<CalendarEventKind, string> = {
  first_meeting: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  intake: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  task_due: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  interaction: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  meeting: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  // C: 未 確定 候補 は 淡い / 破線 で 「まだ 決まって いない」 感 を 出す
  meeting_tentative:
    "border border-dashed border-emerald-400 bg-emerald-50/60 text-emerald-700/80 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300/80",
  company_interview: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  // B: interview_round は company_interview より 濃い 赤 で 「実 施 予定」 の 強調
  interview_round: "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
  // 内定 回答 期限 は 最重要 = 濃い アンバー + 太字 相当 の tone。
  offer_deadline: "bg-amber-200 text-amber-900 font-semibold dark:bg-amber-800 dark:text-amber-100",
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

export function CalendarView({
  initialMonth,
  initialAnchorDate,
  initialEvents,
  clientOptions,
}: CalendarViewProps) {
  const router = useRouter();
  // M1: viewMode / anchor 中心 の 状態 管理 に 移行。
  //   ・yearMonth (fetch key) は anchor から 導出。
  //   ・shiftAnchor / rangeForView / formatPeriodLabel は lib/calendar/period.ts。
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState<string>(initialAnchorDate);
  const yearMonth = useMemo(() => anchor.slice(0, 7), [anchor]);
  const [fetchedMonth, setFetchedMonth] = useState<string>(initialMonth);
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
  // #5b: 手動 会議 予定 作成 ダイアログ (「+ 会議 を 追加」 ボタン / 空 セル + hover)
  const [manualDialog, setManualDialog] = useState<{ open: boolean; dateKey: string }>({
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
      // interview_round / company_interview → 顧客 詳細 の 応募 セクション へ 遷移
      // (referrals ブロック に アンカー を 置け ば さらに 精度 UP。 現状 は 顧客 詳細 の
      //  トップ に 応募 一覧 が ある ため # 付き で 遷移 は 保留)。
      // meeting_tentative → クライアント の LINE 会話 or 顧客 詳細 へ (承諾 確認 導線)。
      // Myaira クライアント有り → クライアント詳細へ
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

  // M1: viewMode ごとに shiftAnchor で アンカー を シフト し、 その アンカー を
  //     含む 月 の データ を fetch (未 fetch の 月 のみ)。
  //     週 / 日 view で は 「その 月 の」 データ が rangeStart/End を 内包 する。
  const navigate = async (delta: number) => {
    const nextAnchor = shiftAnchor(anchor, viewMode, delta);
    setAnchor(nextAnchor);
    const nextMonth = nextAnchor.slice(0, 7);
    if (nextMonth === fetchedMonth) {
      // 同 月 内 シフト は fetch 不要 (週/日 の 場合 の 多く)
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [mairaRes] = await Promise.all([
        fetch(`/api/agency/calendar?month=${nextMonth}`),
        fetchGoogleEvents(nextMonth),
      ]);
      if (!mairaRes.ok) throw new Error(`HTTP ${mairaRes.status}`);
      const json = (await mairaRes.json()) as { events: CalendarEvent[] };
      setEvents(json.events ?? []);
      setFetchedMonth(nextMonth);
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setError(`イベント取得失敗: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // 「今日」 に 戻る ボタン用。 fetch は 必要 に 応じて 発火。
  const goToday = () => {
    // Date.now() は client 側 のみ 使用 (SSR 前 は 走らない)
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const todayYmd = `${y}-${m}-${d}`;
    setAnchor(todayYmd);
    const nextMonth = `${y}-${m}`;
    if (nextMonth !== fetchedMonth) {
      void (async () => {
        setLoading(true);
        try {
          const [mairaRes] = await Promise.all([
            fetch(`/api/agency/calendar?month=${nextMonth}`),
            fetchGoogleEvents(nextMonth),
          ]);
          if (mairaRes.ok) {
            const json = (await mairaRes.json()) as { events: CalendarEvent[] };
            setEvents(json.events ?? []);
            setFetchedMonth(nextMonth);
          }
        } finally {
          setLoading(false);
        }
      })();
    }
  };

  // #5b: 手動 予定 の 作成 / 編集 後 に Myaira 側 の カレンダー イベント を 再 fetch。
  const refreshMaira = useCallback(async () => {
    try {
      const res = await fetch(`/api/agency/calendar?month=${yearMonth}`);
      if (!res.ok) return;
      const json = (await res.json()) as { events: CalendarEvent[] };
      setEvents(json.events ?? []);
      setFetchedMonth(yearMonth);
    } catch {
      // 再 fetch 失敗 は カレンダー 全体 の 描画 を 壊さ ない よう 握り 潰す
    }
  }, [yearMonth]);

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
      {/* ヘッダ:期間切替 + view mode タブ + フィルタ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => navigate(-1)} disabled={loading}>
            ← {viewMode === "month" ? "前月" : viewMode === "week" ? "前週" : "前日"}
          </Button>
          <h2 className="px-3 text-lg font-semibold tabular-nums">
            {formatPeriodLabel(anchor, viewMode)}
          </h2>
          <Button size="sm" variant="outline" onClick={() => navigate(1)} disabled={loading}>
            {viewMode === "month" ? "翌月" : viewMode === "week" ? "翌週" : "翌日"} →
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={goToday}
            disabled={loading}
            className="ml-1 text-xs"
          >
            今日
          </Button>
        </div>
        {/* M1: view mode 切替 タブ */}
        <div className="flex items-center rounded-md border p-0.5">
          {(["month", "week", "day"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={`rounded px-2 py-0.5 text-xs ${
                viewMode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "month" ? "月" : m === "week" ? "週" : "日"}
            </button>
          ))}
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
          {/* #5b: Zoom/Meet 提供者 経由 で は なく Myaira 側 で 予定 を 追加 */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const today = new Date();
              const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
              setManualDialog({ open: true, dateKey });
            }}
          >
            + 会議 を 追加
          </Button>
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

      {/* 曜日ラベル (月ビューのみ。 週/日ビューは WeekDayView 側 で 列 ヘッダを持つ) */}
      {viewMode === "month" && (
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
      )}

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

      {/* #5b: 手動 会議 予定 作成 ダイアログ (「+ 会議 を 追加」 or 空 セル hover の +)。
          key で リマウント させ、 dateKey が 変わった 時 に フォーム 初期 値 が 更新 される。 */}
      {manualDialog.open && (
        <ManualMeetingDialog
          key={manualDialog.dateKey}
          open={manualDialog.open}
          onClose={() => setManualDialog({ open: false, dateKey: "" })}
          initialDateKey={manualDialog.dateKey || undefined}
          clientOptions={clientOptions}
          onCreated={() => {
            void refreshMaira();
          }}
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

      {/* M1: 週 / 日ビュー (時間軸 タイムライン) */}
      {viewMode !== "month" && (
        <WeekDayView
          mode={viewMode}
          columns={buildTimelineColumns(anchor, viewMode)}
          eventsByDate={eventsByDate}
          overlappingIds={overlappingIds}
          kindLabel={KIND_LABEL}
          kindTone={KIND_TONE}
          onEventClick={handleEventClick}
        />
      )}

      {/* 月グリッド(6 週 = 42 セル) */}
      {viewMode === "month" && (
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
                  {/* #5b: 空 セル hover で 手動 会議 追加。 Google 連携 時 は 追加 で +G ボタン。 */}
                  <div className="hidden gap-1 group-hover:flex">
                    <button
                      type="button"
                      onClick={() => setManualDialog({ open: true, dateKey: cell.dateKey })}
                      className="text-muted-foreground/60 hover:text-foreground text-xs leading-none"
                      aria-label="この日に会議を追加"
                      title="Myaira に 会議 予定 を 追加"
                    >
                      +
                    </button>
                    {googleStatus === "connected" && (
                      <button
                        type="button"
                        onClick={() =>
                          setDialog({ open: true, mode: "new", dateKey: cell.dateKey })
                        }
                        className="text-muted-foreground/40 hover:text-foreground text-xs leading-none"
                        aria-label="この日に Google 予定を追加"
                        title="Google カレンダーに予定を追加"
                      >
                        +G
                      </button>
                    )}
                  </div>
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
                        <Mic
                          className="h-2.5 w-2.5 shrink-0 text-emerald-700"
                          aria-label="録音済"
                        />
                      )}
                      {recState === "planned" && (
                        <Mic
                          className="h-2.5 w-2.5 shrink-0 text-amber-600"
                          aria-label="録音予定"
                        />
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
      )}
    </Card>
  );
}

/**
 * 週 / 日ビュー用の列データ (dateKey + ヘッダ ラベル + isToday) を組み立てる。
 * 純粋関数。 anchor が YYYY-MM-DD、 mode が "week" | "day" を想定。
 */
function buildTimelineColumns(
  anchor: string,
  mode: "week" | "day",
): Array<{ dateKey: string; label: string; isToday: boolean }> {
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  if (mode === "day") {
    const [y, m, d] = anchor.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const label = dt.toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
    return [{ dateKey: anchor, label, isToday: anchor === todayYmd }];
  }

  // week: 日曜開始 の 7 日
  const { rangeStart } = getWeekRange(anchor);
  const [y, m, d] = rangeStart.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const cols: Array<{ dateKey: string; label: string; isToday: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const label = dt.toLocaleDateString("ja-JP", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
    });
    cols.push({ dateKey: ymd, label, isToday: ymd === todayYmd });
  }
  return cols;
}

// ────────────────────────────────────────────
// 純粋ヘルパ(Date.now を呼ばない、副作用ゼロ)
// ────────────────────────────────────────────

type MonthCell = { dateKey: string; day: number; inMonth: boolean };

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

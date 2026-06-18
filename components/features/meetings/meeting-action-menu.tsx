"use client";

/**
 * 面談予約に対するアクション(再スケジュール / キャンセル / 今すぐ参加)
 *
 * 共通の Action コンポーネント:
 *   - 一覧画面の行アクション
 *   - カレンダー画面の予定セルクリック後
 *   - クライアント詳細の面談履歴
 *
 * モーダルは内部で持つ。完了後に親へ onChanged を通知して再フェッチさせる。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ExternalLink, MoreHorizontal, Trash2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { useDialog } from "@/lib/ui/use-dialog";
import type { MeetingScheduleView } from "@/lib/meetings/types";

type Props = {
  meeting: MeetingScheduleView;
  onChanged: () => void;
};

/**
 * 開始時刻が「今から N 分以内」かを判定する純関数。
 * 15 分前から「今すぐ参加」を強調表示する用途。
 */
export function isMeetingImminent(
  startsAtIso: string,
  now: Date = new Date(),
  withinMinutes = 15,
): boolean {
  const start = new Date(startsAtIso).getTime();
  const diff = start - now.getTime();
  return diff > -60 * 60 * 1000 && diff < withinMinutes * 60 * 1000;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

export function MeetingActionMenu({ meeting, onChanged }: Props) {
  const [showReschedule, setShowReschedule] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // メニューを document.body に portal で出すので、トリガーボタンの画面座標を
  // 計算して fixed 配置する。Card の overflow-hidden / 後続セクションの z-index
  // による「メニューが埋もれる」問題を回避する。
  // open する瞬間に座標を 計算する(useLayoutEffect だと lint ルールに 引っかかる
  // ので、トリガー click ハンドラで 同期計算 + setState する)。
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const toggleMenu = () => {
    setMenuOpen((prev) => {
      const next = !prev;
      if (next && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setMenuPos({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        });
      }
      return next;
    });
  };
  /**
   * 現在時刻ベースの判定。
   * SSR で false 初期化 → useEffect で 60 秒ごとに更新することで
   * 「開始時刻が過ぎた」「imminent になった」を反映する。
   * Date.now() は react-hooks/purity でレンダー直接呼び出し禁止のため、
   * effect 内で state に書き込んで読む形にする。
   */
  const [now, setNow] = useState<Date | null>(() =>
    typeof window === "undefined" ? null : new Date(),
  );
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const imminent = now ? isMeetingImminent(meeting.startsAt, now) : false;
  const isPast = now
    ? new Date(meeting.startsAt).getTime() < now.getTime() - 60 * 60 * 1000
    : false;

  const cancel = async () => {
    if (
      !confirm(
        "この面談をキャンセルします。よろしいですか?\n求職者にキャンセル通知が送信されます。",
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/agency/meetings/${meeting.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      alert(`キャンセル失敗: ${getErrorMessage(err)}`);
    } finally {
      setSubmitting(false);
      setMenuOpen(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* 今すぐ参加(直前 15 分間は強調) */}
        {!isPast && (
          <Button
            size="sm"
            variant={imminent ? "default" : "outline"}
            className={imminent ? "animate-pulse" : ""}
            onClick={() => window.open(meeting.joinUrl, "_blank", "noopener,noreferrer")}
            disabled={submitting}
          >
            <Video className="size-3.5" />
            {imminent ? "今すぐ参加" : "参加"}
            <ExternalLink className="size-3" />
          </Button>
        )}

        {/* メニュー(再スケジュール / キャンセル) */}
        {!isPast && meeting.status === "scheduled" && (
          <>
            <Button
              ref={triggerRef}
              size="sm"
              variant="ghost"
              onClick={toggleMenu}
              disabled={submitting}
              aria-label="メニュー"
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {/* メニュー本体は body に portal で出す。これで親 Card の overflow-hidden
                / 後続セクションの z-index に 埋もれない。トリガーが画面外に出るまで
                追従させたいなら scroll listener を 足すが、面談履歴 用途では 不要。 */}
            {menuOpen &&
              menuPos &&
              typeof window !== "undefined" &&
              createPortal(
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-60"
                    onClick={() => setMenuOpen(false)}
                    aria-label="閉じる"
                  />
                  <div
                    className="bg-popover fixed z-61 w-48 rounded-md border shadow-md"
                    style={{ top: menuPos.top, right: menuPos.right }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowReschedule(true);
                        setMenuOpen(false);
                      }}
                      className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    >
                      <Calendar className="size-3.5" />
                      再スケジュール
                    </button>
                    <button
                      type="button"
                      onClick={cancel}
                      className="hover:bg-accent text-destructive flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    >
                      <Trash2 className="size-3.5" />
                      キャンセル
                    </button>
                  </div>
                </>,
                document.body,
              )}
          </>
        )}
      </div>

      {/* 再スケジュールダイアログ */}
      {showReschedule && (
        <RescheduleDialog
          meeting={meeting}
          onClose={() => setShowReschedule(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function RescheduleDialog({
  meeting,
  onClose,
  onChanged,
}: {
  meeting: MeetingScheduleView;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, dialogRef);

  const initialDuration = Math.round(
    (new Date(meeting.endsAt).getTime() - new Date(meeting.startsAt).getTime()) / 60000,
  );

  const [title, setTitle] = useState(meeting.title);
  const [agenda, setAgenda] = useState(meeting.agenda);
  const [startLocal, setStartLocal] = useState(toLocalInput(meeting.startsAt));
  const [duration, setDuration] = useState(initialDuration);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/agency/meetings/${meeting.id}`, {
        method: "PATCH",
        json: {
          title: title.trim(),
          agenda: agenda.trim(),
          startsAt: localToIso(startLocal),
          durationMinutes: duration,
        },
      });
      onChanged();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="面談を再スケジュール"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="bg-background max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">面談を再スケジュール</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <label htmlFor="rs_title" className="text-muted-foreground text-xs">
            タイトル
          </label>
          <Input
            id="rs_title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="rs_agenda" className="text-muted-foreground text-xs">
            議題メモ
          </label>
          <textarea
            id="rs_agenda"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            maxLength={4000}
            rows={3}
            className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="rs_start" className="text-muted-foreground text-xs">
              開始日時
            </label>
            <Input
              id="rs_start"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="rs_duration" className="text-muted-foreground text-xs">
              長さ
            </label>
            <select
              id="rs_duration"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
            >
              <option value={15}>15 分</option>
              <option value={30}>30 分</option>
              <option value={45}>45 分</option>
              <option value={60}>60 分</option>
              <option value={90}>90 分</option>
            </select>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          変更内容は求職者にも通知され、新しい .ics が送信されます。
        </p>

        {error && (
          <div className="text-destructive border-destructive/40 bg-destructive/10 rounded border p-2 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "更新中…" : "再スケジュール"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

"use client";

/**
 * Google Calendar イベントの編集 / 削除ダイアログ
 *
 * 入力:既存イベント(externalEventId + 基本フィールド)
 * 操作:タイトル/説明/日時を編集 → Google に PATCH、または削除
 */
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { useDialog } from "@/lib/ui/use-dialog";

export type GoogleEventDialogProps = {
  open: boolean;
  onClose: () => void;
  /** 編集対象。null なら新規作成 */
  initial: {
    externalEventId: string;
    title: string;
    startsAt: string;
    endsAt: string;
    description?: string;
    location?: string;
    joinUrl?: string | null;
  } | null;
  /** 新規作成時の初期日時(YYYY-MM-DD) */
  initialDateKey?: string;
  /** 成功(編集/作成/削除)時に呼ばれる。親はイベントリストを再フェッチする */
  onChanged: () => void;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

function defaultStart(dateKey?: string): string {
  const t = dateKey ? new Date(`${dateKey}T10:00:00`) : new Date();
  if (!dateKey) {
    t.setHours(t.getHours() + 1);
    t.setMinutes(0, 0, 0);
  }
  return toLocalInput(t.toISOString());
}

function plusMinutes(localIso: string, minutes: number): string {
  const d = new Date(localIso);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalInput(d.toISOString());
}

export function GoogleEventDialog({
  open,
  onClose,
  initial,
  initialDateKey,
  onChanged,
}: GoogleEventDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, dialogRef);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [startLocal, setStartLocal] = useState(
    initial ? toLocalInput(initial.startsAt) : defaultStart(initialDateKey),
  );
  const [endLocal, setEndLocal] = useState(
    initial ? toLocalInput(initial.endsAt) : plusMinutes(defaultStart(initialDateKey), 60),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = initial !== null;

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    if (new Date(endLocal).getTime() <= new Date(startLocal).getTime()) {
      setError("終了時刻は開始時刻より後にしてください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        summary: title.trim(),
        description: description.trim(),
        location: location.trim(),
        startsAt: localToIso(startLocal),
        endsAt: localToIso(endLocal),
        timezone: "Asia/Tokyo",
      };
      if (isEdit) {
        await apiFetch(`/api/me/google-calendar/events/${initial!.externalEventId}`, {
          method: "PATCH",
          json: body,
        });
      } else {
        await apiFetch("/api/me/google-calendar/events", {
          method: "POST",
          json: body,
        });
      }
      onChanged();
      handleClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    if (!confirm("この予定を削除しますか?(Google カレンダー側からも削除されます)")) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/me/google-calendar/events/${initial.externalEventId}`, {
        method: "DELETE",
      });
      onChanged();
      handleClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Google 予定を編集" : "Google 予定を新規作成"}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <Card className="bg-background max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? "Google 予定を編集" : "新しい予定(Google カレンダー)"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <label htmlFor="gev_title" className="text-muted-foreground text-xs">
            タイトル
          </label>
          <Input
            id="gev_title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label htmlFor="gev_start" className="text-muted-foreground text-xs">
              開始
            </label>
            <Input
              id="gev_start"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => {
                setStartLocal(e.target.value);
                // 開始を動かしたら終了も同じ尺(1h)で追従させる
                if (!isEdit) {
                  setEndLocal(plusMinutes(e.target.value, 60));
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="gev_end" className="text-muted-foreground text-xs">
              終了
            </label>
            <Input
              id="gev_end"
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="gev_location" className="text-muted-foreground text-xs">
            場所(任意)
          </label>
          <Input
            id="gev_location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="gev_desc" className="text-muted-foreground text-xs">
            説明(任意)
          </label>
          <textarea
            id="gev_desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={8000}
            rows={4}
            className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
          />
        </div>

        {initial?.joinUrl && (
          <div className="text-xs">
            <span className="text-muted-foreground">参加 URL: </span>
            <a
              href={initial.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary break-all hover:underline"
            >
              {initial.joinUrl}
            </a>
          </div>
        )}

        {error && (
          <div className="text-destructive border-destructive/40 bg-destructive/10 rounded border p-2 text-xs">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {isEdit ? (
            <Button
              variant="outline"
              onClick={remove}
              disabled={submitting}
              className="text-destructive"
            >
              削除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={submitting}>
              キャンセル
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "保存中…" : isEdit ? "更新" : "作成"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

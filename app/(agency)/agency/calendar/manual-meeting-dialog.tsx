"use client";

/**
 * 手動 会議 予定 作成 ダイアログ
 *
 * カレンダー か ら 「+ 会議 を 追加」 or 空 セル ク リッ ク で 開く。
 * meeting_schedules に provider='manual' で 1 レコード 挿入 する。
 * Zoom / Meet と 違い 実 会議 URL を 自分 で 発行 する 必要 は なく、
 * 対面 面談 / 電話 会議 / 備忘 予定 の 追加 に 使う。
 */
import { X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDialog } from "@/lib/ui/use-dialog";

type ClientOption = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** 新規 作成 の 初期 日 (YYYY-MM-DD)。 空 セル クリック 時 の 対象 日。 */
  initialDateKey?: string;
  /** 顧客 一覧 (親 の page.tsx で server 側 fetch 済 を props 経由 で 受ける) */
  clientOptions: ClientOption[];
  /** 作成 成功 時 の コールバック (親 は 一覧 を 再 fetch) */
  onCreated: () => void;
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStart(dateKey?: string): string {
  const d = dateKey ? new Date(`${dateKey}T10:00:00`) : new Date();
  return toLocalInput(d.toISOString());
}

function plusMinutes(localIso: string, minutes: number): string {
  const d = new Date(localIso);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalInput(d.toISOString());
}

export function ManualMeetingDialog({
  open,
  onClose,
  initialDateKey,
  clientOptions,
  onCreated,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, dialogRef);

  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState(defaultStart(initialDateKey));
  const [endLocal, setEndLocal] = useState(plusMinutes(defaultStart(initialDateKey), 60));
  const [clientRecordId, setClientRecordId] = useState<string>("");
  const [joinUrl, setJoinUrl] = useState("");
  const [agenda, setAgenda] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フォーム リセット は 親 側 で key={initialDateKey} を 使って リマウント させる こと で 実現。
  // (react-hooks/set-state-in-effect の 警告 を 避ける ため)

  if (!open) return null;

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("タイトル を 入力 して ください");
      return;
    }
    if (new Date(startLocal).getTime() >= new Date(endLocal).getTime()) {
      setError("終了 は 開始 より 後 の 時刻 に して ください");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/agency/meeting-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          starts_at: new Date(startLocal).toISOString(),
          ends_at: new Date(endLocal).toISOString(),
          provider: "manual",
          client_record_id: clientRecordId || null,
          join_url: joinUrl.trim() || null,
          agenda: agenda.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成 失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-meeting-title"
        className="w-full max-w-md space-y-3 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="manual-meeting-title" className="text-base font-semibold">
            会議 予定 を 追加
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="閉じる">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium" htmlFor="mm-title">
              タイトル<span className="text-red-500">*</span>
            </label>
            <Input
              id="mm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 山田 さん 対面 面談"
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium" htmlFor="mm-start">
                開始
              </label>
              <input
                id="mm-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium" htmlFor="mm-end">
                終了
              </label>
              <input
                id="mm-end"
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium" htmlFor="mm-client">
              顧客 (任意)
            </label>
            <select
              id="mm-client"
              value={clientRecordId}
              onChange={(e) => setClientRecordId(e.target.value)}
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm"
            >
              <option value="">紐付け なし</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium" htmlFor="mm-url">
              参加 URL (任意)
            </label>
            <Input
              id="mm-url"
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
              placeholder="https://... (対面 なら 空欄)"
            />
          </div>

          <div>
            <label className="text-xs font-medium" htmlFor="mm-agenda">
              議題 / メモ (任意、 暗号化 保存)
            </label>
            <textarea
              id="mm-agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={2}
              maxLength={2000}
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "作成 中..." : "作成"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

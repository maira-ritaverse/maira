"use client";

import { useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client-fetch";

/**
 * LINE トーク 内 から 「クイック 会議」 を 1 クリック で 作成 + URL 送信。
 *
 * フロー:
 *   1. provider 選択 (Zoom / Google Meet)
 *   2. 開始 タイミング プリセット (今すぐ / 15 / 30 / 60 分 後 / 明日 9-18 時)
 *   3. 時間 セレクト (15 / 30 / 60 / 90 分)
 *   4. 件名 (デフォルト 「面談」)
 *   5. 送信 ボタン → /api/agency/meetings (作成) → /api/agency/line/messages (URL 送信)
 *
 * クライアント レコード が 紐付け 済 で あれば clientRecordId も 同送 (面談 履歴 に 残る)。
 */
type Props = {
  lineUserId: string;
  clientRecordId: string | null;
  onClose: () => void;
  onSent: () => void;
};

type Provider = "zoom" | "google_meet";

type MeetingResponse = {
  meeting: {
    id: string;
    provider: Provider;
    title: string;
    startsAt: string;
    joinUrl: string;
    hostUrl: string | null;
    passcode: string | null;
  };
};

type StartPreset =
  | "now"
  | "in_15m"
  | "in_30m"
  | "in_1h"
  | "tomorrow_9"
  | "tomorrow_13"
  | "tomorrow_18";

const START_OPTIONS: Array<{ value: StartPreset; label: string }> = [
  { value: "now", label: "今すぐ" },
  { value: "in_15m", label: "15 分 後" },
  { value: "in_30m", label: "30 分 後" },
  { value: "in_1h", label: "1 時間 後" },
  { value: "tomorrow_9", label: "明日 9:00" },
  { value: "tomorrow_13", label: "明日 13:00" },
  { value: "tomorrow_18", label: "明日 18:00" },
];

const DURATION_OPTIONS = [15, 30, 60, 90];

function resolveStartIso(preset: StartPreset): string {
  const now = new Date();
  switch (preset) {
    case "now":
      return now.toISOString();
    case "in_15m":
      return new Date(now.getTime() + 15 * 60_000).toISOString();
    case "in_30m":
      return new Date(now.getTime() + 30 * 60_000).toISOString();
    case "in_1h":
      return new Date(now.getTime() + 60 * 60_000).toISOString();
    case "tomorrow_9":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0).toISOString();
    case "tomorrow_13":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 13, 0, 0).toISOString();
    case "tomorrow_18":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0).toISOString();
  }
}

function formatJaDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = d.getHours();
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export function QuickMeetingDialog({ lineUserId, clientRecordId, onClose, onSent }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [provider, setProvider] = useState<Provider>("zoom");
  const [preset, setPreset] = useState<StartPreset>("in_30m");
  const [duration, setDuration] = useState(30);
  const [title, setTitle] = useState("面談");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError("件名 を 入力 して ください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const startsAt = resolveStartIso(preset);

      // 1. meeting 作成
      const json = await apiFetch<MeetingResponse>("/api/agency/meetings", {
        method: "POST",
        json: {
          provider,
          clientRecordId: clientRecordId ?? undefined,
          title: title.trim(),
          startsAt,
          durationMinutes: duration,
        },
      });
      if (!json) {
        throw new Error("meeting 作成 の レスポンス が 取れません でした");
      }

      // 2. LINE で URL を 送信
      const startLabel = formatJaDateTime(json.meeting.startsAt);
      const providerLabel = provider === "zoom" ? "Zoom" : "Google Meet";
      const text =
        `${json.meeting.title} を 設定 しました。\n` +
        `日時: ${startLabel} 〜 (${duration} 分)\n` +
        `参加 URL (${providerLabel}):\n${json.meeting.joinUrl}`;

      const sendRes = await fetch("/api/agency/line/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, text }),
      });
      if (!sendRes.ok) {
        const body = (await sendRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "LINE 送信 に 失敗 しました (会議 は 作成 済)");
      }
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "送信 に 失敗 しました";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="w-full max-w-md space-y-3 rounded-md bg-white p-4 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">クイック 会議</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground text-xs hover:underline"
          >
            閉じる
          </button>
        </div>

        {/* provider */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-[10px]">配信 種別</p>
          <div className="inline-flex rounded-md ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setProvider("zoom")}
              className={`rounded-l-md px-3 py-1 text-xs font-medium ${
                provider === "zoom" ? "bg-emerald-500 text-white" : "bg-white text-slate-600"
              }`}
            >
              Zoom
            </button>
            <button
              type="button"
              onClick={() => setProvider("google_meet")}
              className={`rounded-r-md px-3 py-1 text-xs font-medium ${
                provider === "google_meet" ? "bg-emerald-500 text-white" : "bg-white text-slate-600"
              }`}
            >
              Google Meet
            </button>
          </div>
        </div>

        {/* 開始 */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-[10px]">開始 タイミング</p>
          <div className="flex flex-wrap gap-1.5">
            {START_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreset(opt.value)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  preset === opt.value
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 時間 */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-[10px]">時間 (分)</p>
          <div className="inline-flex rounded-md ring-1 ring-slate-200">
            {DURATION_OPTIONS.map((d, idx) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`px-3 py-1 text-xs ${
                  duration === d ? "bg-slate-900 text-white" : "bg-white text-slate-600"
                } ${idx === 0 ? "rounded-l-md" : ""} ${
                  idx === DURATION_OPTIONS.length - 1 ? "rounded-r-md" : ""
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* 件名 */}
        <div className="space-y-1">
          <p className="text-muted-foreground text-[10px]">件名</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            className="border-input bg-background w-full rounded-md border px-2 py-1 text-sm"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={submitting}
            className="bg-emerald-500 text-white hover:bg-emerald-600"
          >
            {submitting ? "作成 中..." : "作成 して LINE 送信"}
          </Button>
        </div>
      </div>
    </div>
  );
}

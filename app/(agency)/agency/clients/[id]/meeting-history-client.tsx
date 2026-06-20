"use client";

/**
 * 面談履歴のクライアント側レンダリング(行 + 録画ビューア)
 *
 * - 各行に状態バッジ
 * - 「録画/文字起こしを見る」モーダル(取込済みのみ)
 * - 行内に MeetingActionMenu(参加/再スケジュール/キャンセル)
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MeetingActionMenu } from "@/components/features/meetings/meeting-action-menu";
import { useDialog } from "@/lib/ui/use-dialog";

import type { MeetingHistoryEntry } from "./meeting-history-section";

type Props = {
  entries: MeetingHistoryEntry[];
  /** LINE 友達 紐付け 済 の line_user_id (= LINE で URL 送信 可能 か どうか の 判定) */
  lineUserId: string | null;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
}

function providerLabel(p: MeetingHistoryEntry["provider"]): string {
  return p === "zoom" ? "Zoom" : "Google Meet";
}

function statusBadge(m: MeetingHistoryEntry): { label: string; tone: string } {
  if (m.status === "canceled") {
    return { label: "キャンセル", tone: "bg-muted text-muted-foreground" };
  }
  if (m.status === "no_show") {
    return { label: "未参加", tone: "bg-amber-100 text-amber-700" };
  }
  if (m.status === "completed") {
    if (m.recordingId) {
      return { label: "録画あり", tone: "bg-emerald-100 text-emerald-700" };
    }
    return { label: "完了", tone: "bg-emerald-100 text-emerald-700" };
  }
  return { label: "予約済", tone: "bg-blue-100 text-blue-700" };
}

export function MeetingHistoryClient({ entries, lineUserId }: Props) {
  const router = useRouter();
  const [transcriptEntry, setTranscriptEntry] = useState<MeetingHistoryEntry | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendErrorId, setSendErrorId] = useState<{ id: string; message: string } | null>(null);
  const refresh = () => router.refresh();

  const onSendLine = async (m: MeetingHistoryEntry) => {
    if (!lineUserId) return;
    setSendingId(m.id);
    setSendErrorId(null);
    try {
      const text =
        `${m.title} の 日程 を ご案内 します。\n` +
        `日時: ${fmt(m.startsAt)}\n` +
        `参加 URL (${providerLabel(m.provider)}):\n${m.joinUrl}`;
      const res = await fetch("/api/agency/line/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setSendErrorId({ id: m.id, message: e instanceof Error ? e.message : "送信 失敗" });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <>
      <ul className="divide-border divide-y">
        {entries.map((m) => {
          const badge = statusBadge(m);
          return (
            <li
              key={m.id}
              id={m.recordingId ? `recording-${m.recordingId}` : undefined}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{m.title}</span>
                  <span
                    className={`dark:bg-opacity-30 rounded-full px-2 py-0.5 text-[10px] ${badge.tone}`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {providerLabel(m.provider)}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">{fmt(m.startsAt)}</div>
                {m.agenda && (
                  <div className="text-muted-foreground mt-1 text-xs italic">
                    議題:{m.agenda.slice(0, 100)}
                    {m.agenda.length > 100 && "…"}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {m.transcriptText && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTranscriptEntry(m)}
                    title="文字起こしを見る"
                  >
                    <FileText className="size-3.5" />
                    文字起こし
                  </Button>
                )}
                {lineUserId && m.status !== "canceled" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onSendLine(m)}
                    disabled={sendingId === m.id}
                    title="この 会議 の URL を LINE で 送信"
                  >
                    <MessageCircle className="size-3.5" />
                    {sendingId === m.id ? "送信中..." : "LINE 送信"}
                  </Button>
                )}
                <MeetingActionMenu meeting={m} onChanged={refresh} />
              </div>
              {sendErrorId?.id === m.id && (
                <p className="ml-2 text-[10px] text-red-700">{sendErrorId.message}</p>
              )}
            </li>
          );
        })}
      </ul>

      {transcriptEntry && (
        <TranscriptDialog entry={transcriptEntry} onClose={() => setTranscriptEntry(null)} />
      )}
    </>
  );
}

function TranscriptDialog({ entry, onClose }: { entry: MeetingHistoryEntry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, dialogRef);

  const text = entry.transcriptText ?? "(文字起こしを読み込めませんでした)";

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="面談文字起こし"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="bg-background max-h-[90vh] w-full max-w-3xl space-y-3 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{entry.title}</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {fmt(entry.startsAt)} ・ {providerLabel(entry.provider)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="bg-muted/30 max-h-[60vh] overflow-y-auto rounded-md border p-4 text-sm whitespace-pre-wrap">
          {text}
        </div>

        <p className="text-muted-foreground text-xs">
          ※ この文字起こしは Whisper による自動生成です。誤認識を含むことがあります。
          抽出結果は履歴書/職務経歴書のドラフトに反映できます(求職者の同意フロー経由)。
        </p>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </Card>
    </div>
  );
}

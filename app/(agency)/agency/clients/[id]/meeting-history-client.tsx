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
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MeetingActionMenu } from "@/components/features/meetings/meeting-action-menu";
import { useDialog } from "@/lib/ui/use-dialog";

import type { MeetingHistoryEntry } from "./meeting-history-section";

type Props = {
  entries: MeetingHistoryEntry[];
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

export function MeetingHistoryClient({ entries }: Props) {
  const router = useRouter();
  const [transcriptEntry, setTranscriptEntry] = useState<MeetingHistoryEntry | null>(null);
  const refresh = () => router.refresh();

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
                <MeetingActionMenu meeting={m} onChanged={refresh} />
              </div>
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

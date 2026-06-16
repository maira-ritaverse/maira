"use client";

/**
 * 面談一覧クライアントコンポーネント
 *
 * - 今後 / 過去 のタブ切替
 * - 各行に MeetingActionMenu(参加 / 再スケジュール / キャンセル)
 * - 過去面談は録画取込済みなら「録画を見る」リンク(クライアント詳細へ)
 * - router.refresh() で SSR データを再フェッチ
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { MeetingActionMenu } from "@/components/features/meetings/meeting-action-menu";
import type { MeetingScheduleView } from "@/lib/meetings/types";

type Props = {
  upcoming: MeetingScheduleView[];
  past: MeetingScheduleView[];
  clientNames: Record<string, string>;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function providerLabel(p: MeetingScheduleView["provider"]): string {
  return p === "zoom" ? "Zoom" : "Google Meet";
}

function statusBadge(m: MeetingScheduleView): { label: string; tone: string } {
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

export function MeetingsListClient({ upcoming, past, clientNames }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const meetings = tab === "upcoming" ? upcoming : past;
  const refresh = () => router.refresh();

  return (
    <div className="space-y-3">
      <div className="border-border flex border-b">
        <button
          type="button"
          onClick={() => setTab("upcoming")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${
            tab === "upcoming"
              ? "border-primary text-foreground font-semibold"
              : "text-muted-foreground border-transparent"
          }`}
        >
          今後の予定({upcoming.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("past")}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${
            tab === "past"
              ? "border-primary text-foreground font-semibold"
              : "text-muted-foreground border-transparent"
          }`}
        >
          過去({past.length})
        </button>
      </div>

      {meetings.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-muted-foreground text-sm">
            {tab === "upcoming" ? "今後の予定はありません。" : "過去の面談はありません。"}
          </p>
        </Card>
      ) : (
        <Card className="divide-border divide-y">
          {meetings.map((m) => {
            const badge = statusBadge(m);
            const clientName = m.clientRecordId
              ? (clientNames[m.clientRecordId] ?? "(未取得)")
              : null;
            return (
              <div key={m.id} className="flex items-center gap-3 p-3 sm:p-4">
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
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span>{fmt(m.startsAt)}</span>
                    {clientName && m.clientRecordId && (
                      <>
                        <span>•</span>
                        <Link
                          href={`/agency/clients/${m.clientRecordId}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {clientName}
                        </Link>
                      </>
                    )}
                    {m.recordingId && (
                      <>
                        <span>•</span>
                        <Link
                          href={`/agency/clients/${m.clientRecordId ?? ""}#recording-${m.recordingId}`}
                          className="text-primary hover:underline"
                        >
                          録画を見る
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <MeetingActionMenu meeting={m} onChanged={refresh} />
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

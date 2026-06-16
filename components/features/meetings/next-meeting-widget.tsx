"use client";

/**
 * 「次の面談」ウィジェット
 *
 * 24 時間以内に開始される本人主催の面談を 1 件大きく表示し、
 * 開始 15 分前から「今すぐ参加」を強調する。
 *
 * クライアントコンポーネントにすることで、サーバーから取れない
 * 「クライアント時刻に基づく imminent 判定」をリアクティブに更新できる。
 *
 * 初期データはサーバーから props 経由で渡す(SSR 高速化)。
 * クライアントマウント後は 60 秒ごとに自前で再フェッチして、長時間開いた
 * ままでも「開始時刻に達した」を検出できる。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isMeetingImminent } from "./meeting-action-menu";
import type { MeetingScheduleView } from "@/lib/meetings/types";

type Props = {
  initial: MeetingScheduleView | null;
};

function formatStart(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutesUntil(iso: string, now: Date = new Date()): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
}

function providerLabel(p: MeetingScheduleView["provider"]): string {
  return p === "zoom" ? "Zoom" : "Google Meet";
}

export function NextMeetingWidget({ initial }: Props) {
  const [meeting, setMeeting] = useState<MeetingScheduleView | null>(initial);
  /**
   * 現在時刻。
   * - SSR では null(window 不在)
   * - クライアント初回マウント時に lazy initializer で取得
   * - 60 秒ごとに interval から setNow(callback 内なので set-state-in-effect 回避)
   * これにより react-hooks/purity と set-state-in-effect の両方を満たす。
   */
  const [now, setNow] = useState<Date | null>(() =>
    typeof window === "undefined" ? null : new Date(),
  );

  // 60 秒ごとに最新の予定と時刻を更新(interval callback 内の setState は OK)
  useEffect(() => {
    const id = window.setInterval(async () => {
      setNow(new Date());
      try {
        const res = await fetch("/api/agency/meetings/next");
        if (!res.ok) return;
        const json = (await res.json()) as { meeting: MeetingScheduleView | null };
        setMeeting(json.meeting);
      } catch {
        // ネットワーク失敗時は更新しない(画面はそのまま)
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!meeting) return null;

  // now が null(初回 SSR / 初期描画)では imminent 判定を出さない
  const imminent = now ? isMeetingImminent(meeting.startsAt, now) : false;
  const mins = now ? minutesUntil(meeting.startsAt, now) : 0;

  return (
    <Card
      className={`flex flex-wrap items-center gap-4 p-4 ${
        imminent ? "border-primary bg-primary/5" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {imminent ? (
            <span className="text-primary inline-flex items-center gap-1.5 font-semibold">
              <span className="bg-primary inline-block size-1.5 rounded-full" aria-hidden />
              {mins <= 0 ? "まもなく開始" : `開始まで ${mins} 分`}
            </span>
          ) : (
            <span>次の面談</span>
          )}
          <span>•</span>
          <span>{providerLabel(meeting.provider)}</span>
        </div>
        <div className="mt-1 text-base font-semibold">{meeting.title}</div>
        <div className="text-muted-foreground mt-1 text-xs">{formatStart(meeting.startsAt)}</div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={imminent ? "default" : "outline"}
          className={imminent ? "animate-pulse" : ""}
          onClick={() => window.open(meeting.joinUrl, "_blank", "noopener,noreferrer")}
        >
          <Video className="size-3.5" />
          参加
          <ExternalLink className="size-3" />
        </Button>
        <Button size="sm" variant="ghost" render={<Link href="/agency/meetings" />}>
          一覧
        </Button>
      </div>
    </Card>
  );
}

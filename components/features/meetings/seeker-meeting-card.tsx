"use client";

/**
 * 求職者向け「面談に参加する」カード
 *
 * 設計方針:
 *   - 求職者の関心は「参加するだけ」。タイトル / 日時 / 大きな参加ボタンだけ出す
 *   - provider 名 / agenda / 件数バッジ等は出さない(機密 + ノイズ)
 *   - 開始 15 分前から「今すぐ参加」を強調(パルス)
 *   - 1 件もなければカード自体を出さない(ダッシュボードに穴を空けない)
 *   - 複数件あるときは「次の 1 件」を大きく + 「他に N 件」を控えめにテキストで出す
 *
 * 「今すぐ参加」の時刻判定はクライアントタイマー必須。
 * Date.now() / new Date() を render 中で直接呼ばないため
 * useState の lazy initializer + useEffect interval で対処する。
 */
import { useEffect, useState } from "react";
import { ExternalLink, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isMeetingImminent } from "@/components/features/meetings/meeting-action-menu";
import type { MeetingScheduleView } from "@/lib/meetings/types";

type Props = {
  meetings: MeetingScheduleView[];
};

function formatStartLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
}

function minutesUntil(iso: string, now: Date): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
}

export function SeekerMeetingCard({ meetings }: Props) {
  // クライアント時刻(SSR では null、マウント後に毎分更新)
  const [now, setNow] = useState<Date | null>(() =>
    typeof window === "undefined" ? null : new Date(),
  );
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (meetings.length === 0) return null;

  // 次の 1 件をメイン表示
  const [next, ...rest] = meetings;
  const imminent = now ? isMeetingImminent(next.startsAt, now) : false;
  const mins = now ? minutesUntil(next.startsAt, now) : null;

  return (
    <Card className={`space-y-3 p-5 ${imminent ? "border-primary bg-primary/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {imminent ? (
              <span className="text-primary inline-flex items-center gap-1.5 font-semibold">
                <span
                  className="bg-primary inline-block size-1.5 animate-pulse rounded-full"
                  aria-hidden
                />
                {mins != null && mins <= 0 ? "まもなく開始" : `開始まで ${mins} 分`}
              </span>
            ) : (
              <span>次の面談</span>
            )}
          </div>
          <div className="mt-1 text-base font-semibold">{next.title}</div>
          <div className="text-muted-foreground mt-1 text-sm">
            {formatStartLabel(next.startsAt)}
          </div>
        </div>

        <Button
          size="lg"
          variant={imminent ? "default" : "outline"}
          className={imminent ? "animate-pulse" : ""}
          onClick={() => window.open(next.joinUrl, "_blank", "noopener,noreferrer")}
        >
          <Video className="size-4" />
          会議に参加
          <ExternalLink className="size-3.5" />
        </Button>
      </div>

      {/* 2 件目以降は控えめに */}
      {rest.length > 0 && (
        <div className="text-muted-foreground border-t pt-2 text-xs">
          このあと {rest.length} 件の予定があります。
        </div>
      )}
    </Card>
  );
}

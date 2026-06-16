/**
 * 「今後の面談予定」カード
 *
 * - エージェント側 / 求職者側 の両方で使う(props.viewer で表示分岐)
 * - 渡された MeetingScheduleView の配列をそのままレンダリング
 * - 1 件もなければ「予定はありません」を出す(ダッシュボードに穴は開けない)
 *
 * 暗号化された agenda はサーバーで復号した状態で渡される前提。
 * 表示は安全のため XSS エスケープ不要(React の標準テキスト)。
 */
import { Calendar, ExternalLink, Video } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { MeetingScheduleView } from "@/lib/meetings/types";

type Props = {
  meetings: MeetingScheduleView[];
  /** "agency": agenda を出す / "seeker": agenda を伏せる(機密) */
  viewer: "agency" | "seeker";
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

function providerLabel(p: MeetingScheduleView["provider"]): string {
  return p === "zoom" ? "Zoom" : "Google Meet";
}

export function UpcomingMeetingsCard({ meetings, viewer }: Props) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Calendar className="size-4" />
          今後の面談予定
        </div>
        {meetings.length > 0 && (
          <span className="text-muted-foreground text-xs">{meetings.length} 件</span>
        )}
      </div>

      {meetings.length === 0 ? (
        <p className="text-muted-foreground text-sm">予定はありません。</p>
      ) : (
        <ul className="divide-border space-y-2 divide-y">
          {meetings.map((m) => (
            <li key={m.id} className="space-y-1 pt-2 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{m.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {formatStartLabel(m.startsAt)} ・ {providerLabel(m.provider)}
                  </div>
                </div>
                <a
                  href={m.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex shrink-0 items-center gap-1 text-xs hover:underline"
                  aria-label="会議に参加"
                >
                  <Video className="size-3" />
                  参加
                  <ExternalLink className="size-3" />
                </a>
              </div>
              {viewer === "agency" && m.agenda && (
                <div className="text-muted-foreground bg-muted/40 mt-1 rounded px-2 py-1 text-xs">
                  {m.agenda}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

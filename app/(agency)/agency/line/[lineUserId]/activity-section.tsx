"use client";

import { Briefcase, CalendarCheck, CalendarX, Heart, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 利用履歴 (Activity Timeline) セクション
 *
 * 種別:
 *   ・job_share — 求人 を Flex で 共有
 *   ・job_interest — 求職者 が 「興味あり」 を タップ
 *   ・meeting_proposed / confirmed / canceled — 面談 ライフサイクル
 */
type ActivityItem =
  | {
      kind: "job_share";
      at: string;
      jobId: string;
      companyName: string;
      position: string;
    }
  | {
      kind: "job_interest";
      at: string;
      jobId: string;
      companyName: string;
      position: string;
    }
  | {
      kind: "meeting_proposed" | "meeting_confirmed" | "meeting_canceled";
      at: string;
      meetingId: string;
      title: string;
      startsAt: string;
    };

type Props = { lineUserId: string };

export function ActivitySection({ lineUserId }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`/api/agency/line/activity/${encodeURIComponent(lineUserId)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: ActivityItem[] };
        if (active) setItems(json.items);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [lineUserId]);

  return (
    <div className="space-y-2 px-4 py-4">
      <p className="text-xs font-semibold">利用履歴 {!loading && `(${items.length})`}</p>

      {loading ? (
        <p className="text-muted-foreground text-[11px]">読み込み中...</p>
      ) : error ? (
        <p className="text-[11px] text-red-600">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-[11px]">まだ 行動 履歴 が ありません。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-[11px]">
              <ActivityIcon kind={item.kind} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{labelFor(item)}</p>
                <p className="text-muted-foreground text-[10px]">
                  {new Date(item.at).toLocaleString("ja-JP", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function labelFor(item: ActivityItem): string {
  switch (item.kind) {
    case "job_share":
      return `求人共有: ${item.position} (${item.companyName})`;
    case "job_interest":
      return `「興味あり」 ${item.position} (${item.companyName})`;
    case "meeting_proposed":
      return `面談 提案: ${item.title}`;
    case "meeting_confirmed":
      return `面談 確定: ${item.title} (${new Date(item.startsAt).toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })})`;
    case "meeting_canceled":
      return `面談 キャンセル: ${item.title}`;
  }
}

function ActivityIcon({ kind }: { kind: ActivityItem["kind"] }) {
  const cls = "size-3.5 shrink-0";
  switch (kind) {
    case "job_share":
      return <Send className={`${cls} text-blue-600`} aria-hidden />;
    case "job_interest":
      return <Heart className={`${cls} text-pink-600`} aria-hidden />;
    case "meeting_proposed":
      return <Briefcase className={`${cls} text-slate-500`} aria-hidden />;
    case "meeting_confirmed":
      return <CalendarCheck className={`${cls} text-emerald-700`} aria-hidden />;
    case "meeting_canceled":
      return <CalendarX className={`${cls} text-red-600`} aria-hidden />;
  }
}

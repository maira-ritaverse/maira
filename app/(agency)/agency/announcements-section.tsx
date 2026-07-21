"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_CATEGORY_CLASS,
  PLATFORM_CATEGORY_LABEL,
  type PlatformAnnouncement,
} from "@/lib/announcements/platform-types";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

/**
 * エージェントダッシュボード用「Myaira からのお知らせ」セクション。
 *
 * - マウント時に GET /api/announcements で一覧取得
 * - pinned が先頭、その後 publishedAt 降順
 * - 既読/未読で見た目を分岐(未読は太字 + 左にドット)
 * - require_ack のお知らせは「承知しました」ボタンを押すまで既読扱いにならない
 * - CTA があれば右側に open ボタン
 *
 * 設計判断:
 *   - 「お知らせ」セクション自体はダッシュボードに常設(0 件のときは空状態を出す)
 *   - 未読バッジは別途 SectionLayoutContainer 側で出すか、本コンポネントで自前表示
 */
export function AnnouncementsSection() {
  const [items, setItems] = useState<PlatformAnnouncement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acking, setAcking] = useState<string | null>(null);
  const didFetchRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ items: PlatformAnnouncement[] }>("/api/announcements");
      setItems(res?.items ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    void load();
  }, [load]);

  const handleAck = async (a: PlatformAnnouncement) => {
    setAcking(a.id);
    try {
      await apiFetch(`/api/announcements/${a.id}/read`, {
        method: "POST",
        json: { acknowledge: a.requireAck },
      });
      // ローカル反映:該当行に readAt を立てる
      setItems((cur) =>
        (cur ?? []).map((x) =>
          x.id === a.id
            ? {
                ...x,
                readAt: new Date().toISOString(),
                acknowledgedAt: a.requireAck ? new Date().toISOString() : x.acknowledgedAt,
              }
            : x,
        ),
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAcking(null);
    }
  };

  if (items === null) {
    return <p className="text-muted-foreground text-xs">読み込み中…</p>;
  }

  if (error) {
    return <p className="text-destructive text-xs">お知らせの読み込みに失敗しました:{error}</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">現在お知らせはありません。</p>
    );
  }

  return (
    <ul className="divide-foreground/10 divide-y">
      {items.map((a) => {
        const isUnread = a.readAt === null;
        const needsAck = a.requireAck && a.acknowledgedAt === null;
        return (
          <li key={a.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                {isUnread && (
                  <span
                    className="bg-primary mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                    aria-hidden
                  />
                )}
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PLATFORM_CATEGORY_CLASS[a.category]}`}
                    >
                      {PLATFORM_CATEGORY_LABEL[a.category]}
                    </span>
                    {a.isPinned && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        <Pin className="h-3 w-3" />
                        固定
                      </span>
                    )}
                    {a.requireAck && a.acknowledgedAt === null && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-700 dark:bg-rose-950 dark:text-rose-200">
                        要承認
                      </span>
                    )}
                  </div>
                  <p className={`${isUnread ? "font-semibold" : "font-normal"} text-sm`}>
                    {a.title}
                  </p>
                  <p className="text-muted-foreground text-xs whitespace-pre-wrap">{a.body}</p>
                  <p className="text-muted-foreground text-[10px]">
                    {new Date(a.publishedAt).toLocaleString("ja-JP")}
                    {a.expiresAt && ` 〜 ${new Date(a.expiresAt).toLocaleDateString("ja-JP")} まで`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {a.ctaUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.open(a.ctaUrl!, "_blank", "noopener,noreferrer");
                      // CTA を踏んだら既読扱いに(ack 必須なら ack も同時に)
                      void handleAck(a);
                    }}
                  >
                    {a.ctaLabel ?? "詳細を見る"}
                  </Button>
                )}
                {needsAck ? (
                  <Button size="sm" onClick={() => void handleAck(a)} disabled={acking === a.id}>
                    {acking === a.id ? "送信中…" : "承知しました"}
                  </Button>
                ) : (
                  isUnread && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleAck(a)}
                      disabled={acking === a.id}
                    >
                      既読にする
                    </Button>
                  )
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

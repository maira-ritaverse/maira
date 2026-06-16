"use client";

/**
 * カレンダー購読 URL 発行 / 失効 UI
 *
 * 用途:
 *   ・Maira の予定(面談・タスク期限)を Google Calendar 等で「他のカレンダーを追加 → URL」
 *     で購読してもらう
 *
 * 設計判断:
 *   ・初回ロード時に GET で既存トークン有無を確認(SSR にはせず、クライアントで遅延ロード)
 *   ・コピー機能:navigator.clipboard.writeText、失敗時はテキスト選択にフォールバック
 *   ・再発行は POST、失効は DELETE
 *   ・トークン文字列自体は URL に含まれるので、表示時に「秘密 URL」と注意書きを出す
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type FeedInfo = {
  url: string;
  lastAccessedAt: string | null;
  createdAt: string;
};

export function CalendarFeedSection() {
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const json = await apiFetch<{ feed: FeedInfo | null }>("/api/me/calendar-feed-token");
        if (cancelled) return;
        setFeed(json?.feed ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const issue = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const json = await apiFetch<{ feed: { url: string } }>("/api/me/calendar-feed-token", {
        method: "POST",
      });
      if (json?.feed) {
        setFeed({ url: json.feed.url, lastAccessedAt: null, createdAt: new Date().toISOString() });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async () => {
    if (!confirm("購読 URL を失効しますか?(購読中のカレンダーから Maira の予定が消えます)")) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/me/calendar-feed-token", { method: "DELETE" });
      setFeed(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // フォールバック:select
      const el = document.getElementById("feed_url_input") as HTMLInputElement | null;
      el?.select();
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold">カレンダー購読 URL</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Maira の面談予定 / タスク期限を、Google Calendar / Apple Calendar / Outlook
          で購読できます。 発行された URL を「他のカレンダーを追加 → URL
          から追加」に貼り付けてください。
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-xs">読み込み中…</p>
      ) : feed ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="feed_url_input"
              readOnly
              value={feed.url}
              className="border-input bg-muted/40 h-9 flex-1 rounded-lg border px-3 font-mono text-xs"
              onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
            />
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? "コピー済み" : "コピー"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            この URL を知っている人は、あなたの予定タイトル・面談 URL
            を見られます。漏えいに注意してください。
          </p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            {feed.lastAccessedAt ? (
              <span>最終アクセス: {new Date(feed.lastAccessedAt).toLocaleString("ja-JP")}</span>
            ) : (
              <span>まだアクセスされていません</span>
            )}
            <button
              type="button"
              onClick={issue}
              disabled={submitting}
              className="hover:text-foreground underline-offset-4 hover:underline"
            >
              URL を再発行する
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={submitting}
              className="text-destructive underline-offset-4 hover:underline"
            >
              失効する
            </button>
          </div>
        </div>
      ) : (
        <Button onClick={issue} disabled={submitting} size="sm">
          {submitting ? "発行中…" : "購読 URL を発行する"}
        </Button>
      )}

      {error && (
        <div className="text-destructive border-destructive/40 bg-destructive/10 rounded border p-2 text-xs">
          {error}
        </div>
      )}

      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">Google Calendar に追加する手順</summary>
        <ol className="mt-2 ml-4 list-decimal space-y-1">
          <li>Google Calendar を開く</li>
          <li>
            左サイドバー「他のカレンダー」の <span className="font-mono">+</span> ボタンをクリック
          </li>
          <li>「URL で追加」を選択</li>
          <li>上記の URL を貼り付け → 「カレンダーを追加」</li>
          <li>反映には 6〜24 時間かかる場合があります(Google 側のキャッシュ仕様)</li>
        </ol>
      </details>
    </Card>
  );
}

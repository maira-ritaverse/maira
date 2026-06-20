"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client-fetch";
import type { AdvisorMessageView, AdvisorSenderKind } from "@/lib/advisor/types";

/**
 * Advisor チャット の 共通 UI
 *
 * 役割:
 *   ・初期 メッセージ 一覧 を 受け取り、 新着 を 30 秒 おき に poll で 取得
 *   ・本文 入力 + 送信 (textarea + Enter で 送信 / Shift+Enter で 改行)
 *
 * 求職者 / エージェント の どちら でも 共通 で 使える よう に、 endpoint 系 と
 * 「自分 の 側 (currentUserId / mySenderKind)」を props で 受け取る。
 */
type Props = {
  threadId: string;
  initialMessages: AdvisorMessageView[];
  /** 自分 の user.id (吹き出し 左右 振り分け 用) */
  currentUserId: string;
  /** 自分 の sender_kind (seeker か agency) */
  mySenderKind: AdvisorSenderKind;
  /** メッセージ 取得 API (例: /api/app/advisor/threads/{id}/messages) */
  fetchMessagesUrl: string;
  /** メッセージ 投稿 API (同 URL の POST) */
  postMessageUrl: string;
  /** 自動 ポーリング 間隔 (ms)。 0 で 無効 */
  pollIntervalMs?: number;
};

export function AdvisorChat({
  initialMessages,
  currentUserId,
  mySenderKind,
  fetchMessagesUrl,
  postMessageUrl,
  pollIntervalMs = 30_000,
}: Props) {
  const [messages, setMessages] = useState<AdvisorMessageView[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新着 が 末尾 に 追加 された ら 自動 スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // 定期 ポーリング (新着 受信 用)
  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(fetchMessagesUrl);
        if (!res.ok) return;
        const json = (await res.json()) as { messages: AdvisorMessageView[] };
        setMessages((prev) => {
          // 件数 が 増えて いれば 置き換え (簡易)
          if (json.messages.length !== prev.length) return json.messages;
          return prev;
        });
      } catch {
        // ポーリング 失敗 は サイレント
      }
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [fetchMessagesUrl, pollIntervalMs]);

  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(postMessageUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; messageId: string; createdAt: string }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in data && data.ok)) {
        const msg =
          "message" in data && data.message
            ? data.message
            : "error" in data
              ? data.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      // 楽観 追加: 自分 の 投稿 を 即時 表示
      setMessages((prev) => [
        ...prev,
        {
          id: data.messageId,
          threadId: "",
          senderKind: mySenderKind,
          senderUserId: currentUserId,
          content: body,
          readAt: null,
          createdAt: data.createdAt,
        },
      ]);
      setText("");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto rounded-md border bg-slate-50/50 p-3"
      >
        {messages.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            まだ メッセージ は ありません。
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderKind === mySenderKind;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[75%] space-y-0.5">
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      mine
                        ? "bg-emerald-500 text-white"
                        : "border border-slate-200 bg-white text-slate-800"
                    }`}
                  >
                    {m.content}
                  </div>
                  <p
                    className={`text-[10px] ${
                      mine ? "text-muted-foreground text-right" : "text-muted-foreground"
                    }`}
                  >
                    {new Date(m.createdAt).toLocaleString("ja-JP")}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void onSend();
              }
            }}
            rows={2}
            maxLength={5000}
            placeholder="メッセージ を 入力 (Enter で 送信、 Shift+Enter で 改行)"
            className="border-input bg-background flex-1 resize-y rounded-md border px-3 py-2 text-sm"
          />
          <Button
            onClick={() => void onSend()}
            disabled={!text.trim() || sending}
            className="bg-emerald-500 text-white hover:bg-emerald-600"
          >
            {sending ? "送信中…" : "送信"}
          </Button>
        </div>
      </div>
    </div>
  );
}

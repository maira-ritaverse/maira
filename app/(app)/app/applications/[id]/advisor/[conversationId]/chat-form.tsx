"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MessageForChat } from "@/lib/career/conversations";

/**
 * 応募アドバイザー チャットフォーム
 *
 * career の chat-form.tsx と同じ AI SDK v6 パターン:
 * - 過去メッセージはサーバー側で取得済みのものを useChat の messages に渡す
 * - DefaultChatTransport で applicationId 配下のエンドポイントに POST し、
 *   conversationId を body に同梱
 * - 新規セッションは「(セッション開始)」ダミーで Maira から先に話しかけさせる
 *   (API 側でこのダミーは DB 保存しない)
 */

type Props = {
  applicationId: string;
  conversationId: string;
  initialMessages: MessageForChat[];
};

const SESSION_OPENER = "(セッション開始)";

export function AdvisorChatForm({ applicationId, conversationId, initialMessages }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const openerSentRef = useRef(false);

  const seedMessages = useMemo<UIMessage[]>(
    () =>
      initialMessages.map((m, i) => ({
        id: `initial-${i}`,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      })),
    [initialMessages],
  );

  // applicationId / conversationId に応じてエンドポイントと body が決まる
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/applications/${applicationId}/advisor`,
        body: { conversationId },
      }),
    [applicationId, conversationId],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: seedMessages,
  });

  // 新着メッセージで自動スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // 新規セッションのときだけ、Maira から最初の挨拶を引き出す
  // openerSentRef で Strict Mode の二重マウントによる重複送信を防ぐ
  useEffect(() => {
    if (
      !openerSentRef.current &&
      initialMessages.length === 0 &&
      messages.length === 0 &&
      status === "ready"
    ) {
      openerSentRef.current = true;
      sendMessage({ text: SESSION_OPENER });
    }
  }, [initialMessages.length, messages.length, status, sendMessage]);

  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  // ダミーオープナーは画面に出さない
  const visibleMessages = messages.filter((m) => {
    if (m.role !== "user") return true;
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");
    return text !== SESSION_OPENER;
  });

  return (
    <div className="flex h-full flex-col gap-4">
      <div
        ref={scrollRef}
        className="bg-card flex-1 space-y-4 overflow-y-auto rounded-lg border p-4"
      >
        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              <p className="mb-1 text-xs opacity-70">
                {message.role === "user" ? "あなた" : "Maira"}
              </p>
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <div key={index} className="whitespace-pre-wrap">
                      {part.text}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2">
              <p className="text-xs opacity-70">Maira</p>
              <p className="animate-pulse">考えています...</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error.message}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力..."
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? "送信中" : "送信"}
        </Button>
      </form>
    </div>
  );
}

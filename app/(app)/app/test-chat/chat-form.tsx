"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * AI動作確認用のチャットフォーム
 *
 * - useChat は @ai-sdk/react から import(v6 から ai 本体と分離)
 * - 通信は内部で /api/chat に向く(DefaultChatTransport のデフォルト)
 * - メッセージは parts 配列で配信される(v6 仕様)。text 以外の part も
 *   将来出てくる可能性があるため、type で分岐する形にしておく
 */
export function ChatForm() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat();

  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 会話履歴 */}
      <div className="bg-card flex-1 space-y-4 overflow-y-auto rounded-lg border p-4">
        {messages.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            メッセージを送って会話を始めましょう
          </p>
        ) : (
          messages.map((message) => (
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
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2">
              <p className="text-xs opacity-70">Maira</p>
              <p className="animate-pulse">考えています...</p>
            </div>
          </div>
        )}
      </div>

      {/* エラー表示 */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラーが発生しました: {error.message}</AlertDescription>
        </Alert>
      )}

      {/* 入力フォーム */}
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

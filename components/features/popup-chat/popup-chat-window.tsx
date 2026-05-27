"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MessageForChat } from "@/lib/career/conversations";
import { usePopupChat } from "./popup-chat-context";

/**
 * ポップアップチャット本体ウィンドウ
 *
 * レイアウト:
 * - デスクトップ:画面右下のフローティングウィンドウ(400×600)
 * - モバイル:画面下からの Bottom Sheet 風(全幅・80vh)
 * - 最大化時:画面ほぼ全体
 *
 * フロー:
 * 1. 開いた時、その応募の advisor セッションを GET で取得
 *    なければ POST で新規作成
 * 2. 過去メッセージを GET でロード
 * 3. conversationId が確定したら、内部の PopupChatActive で useChat を生成
 *    (useChat の transport が依存する値が固まってから初期化したいので分離)
 *
 * 既存の独立画面 chat-form.tsx と同じ AI SDK v6 パターンを踏襲。
 */

type SessionStatus = "idle" | "loading" | "ready" | "error";

export function PopupChatWindow() {
  const {
    isOpen,
    isMaximized,
    applicationId,
    conversationId,
    setConversationId,
    close,
    toggleMaximize,
  } = usePopupChat();

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<MessageForChat[]>([]);

  // ポップアップを開いた時に セッション初期化(取得 or 作成 + 履歴ロード)
  useEffect(() => {
    if (!isOpen || !applicationId) return;

    // 同じ応募で再オープン → 既存の conversationId と initialMessages を使う
    // (close 時に明示的にリセットしないので、status と conversationId が残っていれば再利用)
    if (conversationId && sessionStatus === "ready") {
      return;
    }

    let cancelled = false;

    const initSession = async () => {
      setSessionStatus("loading");
      setSessionError(null);

      try {
        // 1. この応募の最新セッションを取得
        const getRes = await fetch(`/api/applications/${applicationId}/advisor/session`);
        if (!getRes.ok) {
          const errData = (await getRes.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(errData.message ?? errData.error ?? "Failed to fetch session");
        }
        const getData = (await getRes.json()) as { conversationId: string | null };

        let convId = getData.conversationId;

        // 2. なければ新規作成
        if (!convId) {
          const postRes = await fetch(`/api/applications/${applicationId}/advisor/session`, {
            method: "POST",
          });
          if (!postRes.ok) {
            const errData = (await postRes.json().catch(() => ({}))) as {
              error?: string;
              message?: string;
            };
            throw new Error(errData.message ?? errData.error ?? "Failed to create session");
          }
          const postData = (await postRes.json()) as { conversationId: string };
          convId = postData.conversationId;
        }

        if (cancelled) return;

        // 3. 過去メッセージをロード(新規作成直後なら空配列)
        const msgRes = await fetch(
          `/api/applications/${applicationId}/advisor/messages?conversationId=${convId}`,
        );
        let loaded: MessageForChat[] = [];
        if (msgRes.ok) {
          const msgData = (await msgRes.json()) as { messages: MessageForChat[] };
          loaded = msgData.messages;
        }

        if (cancelled) return;

        setInitialMessages(loaded);
        setConversationId(convId);
        setSessionStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setSessionError(err instanceof Error ? err.message : "Unknown error");
        setSessionStatus("error");
      }
    };

    initSession();

    return () => {
      cancelled = true;
    };
    // applicationId / isOpen が変わった時に再初期化したい。
    // conversationId・setConversationId は途中で変わっても再走させたくないため
    // 依存配列から除外(eslint コメントで明示)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, applicationId]);

  // Esc で閉じる
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen || !applicationId) return null;

  // 通常時のモバイル:bottom-0で全幅(Bottom Sheet風)、sm以上で右下400×600
  const sizeClasses = isMaximized
    ? "inset-4 sm:inset-8"
    : "right-0 bottom-0 left-0 h-[80vh] sm:right-6 sm:bottom-6 sm:left-auto sm:h-[600px] sm:w-[400px] sm:max-h-[calc(100vh-3rem)]";

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Mairaチャット"
      className={`bg-background fixed z-50 flex flex-col rounded-t-lg border shadow-2xl sm:rounded-lg ${sizeClasses}`}
    >
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <span className="font-medium">Mairaに相談</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMaximize}
            aria-label={isMaximized ? "縮小" : "最大化"}
            className="hover:bg-accent rounded p-1"
          >
            <span className="text-xs">{isMaximized ? "◱" : "⛶"}</span>
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="hover:bg-accent rounded p-1"
          >
            <span className="text-xs">✕</span>
          </button>
        </div>
      </div>

      {sessionStatus === "loading" && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">Mairaを呼び出しています...</p>
        </div>
      )}

      {sessionStatus === "error" && (
        <div className="flex flex-1 items-center justify-center p-4">
          <Alert variant="destructive">
            <AlertDescription>{sessionError ?? "セッション初期化に失敗しました"}</AlertDescription>
          </Alert>
        </div>
      )}

      {sessionStatus === "ready" && conversationId && (
        <PopupChatActive
          applicationId={applicationId}
          conversationId={conversationId}
          initialMessages={initialMessages}
        />
      )}
    </div>
  );
}

/**
 * 新規セッションで Maira から最初の挨拶を引き出すためのダミー入力。
 * API 側でこの内容は DB 保存されない。独立画面 advisor の値と合わせる。
 */
const SESSION_OPENER = "(セッション開始)";

/**
 * セッション ready 後のチャット本体
 *
 * useChat の transport は applicationId と conversationId に依存するため、
 * 値が確定してから初期化したい。そのため親で session ready 後にマウントする。
 */
function PopupChatActive({
  applicationId,
  conversationId,
  initialMessages,
}: {
  applicationId: string;
  conversationId: string;
  initialMessages: MessageForChat[];
}) {
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

  // 新規セッションのときだけ、Maira から最初の挨拶を引き出す。
  // openerSentRef で Strict Mode の二重マウントによる重複送信を防ぐ。
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
    <>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {message.parts.map((part, idx) => {
                if (part.type === "text") {
                  return (
                    <div key={idx} className="whitespace-pre-wrap">
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
            <div className="bg-muted rounded-lg px-3 py-2 text-sm">
              <span className="animate-pulse">考えています...</span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 pb-2">
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              申し訳ありません、エラーが発生しました。少し時間を置いてから再度お試しください。
            </AlertDescription>
          </Alert>
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t p-3">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="メッセージを入力..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !input.trim()} size="sm">
            送信
          </Button>
        </div>
      </form>
    </>
  );
}

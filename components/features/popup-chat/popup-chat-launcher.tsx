"use client";

import { MessageSquare } from "lucide-react";

import { usePopupChat } from "./popup-chat-context";

/**
 * ポップアップチャットのフローティング起動ボタン
 *
 * 表示条件:
 * - applicationId が設定されている(= 応募詳細ページにいる時のみ)
 * - 既にポップアップが開いていない
 *
 * Layout全体に常駐させても、上記の条件で表示制御されるため安全。
 */
export function PopupChatLauncher() {
  const { applicationId, isOpen, openForApplication } = usePopupChat();

  if (!applicationId || isOpen) return null;

  return (
    <button
      type="button"
      onClick={() => openForApplication(applicationId)}
      className="bg-primary text-primary-foreground focus:ring-ring fixed right-6 bottom-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      aria-label="Mairaに相談"
    >
      <MessageSquare className="h-6 w-6" />
    </button>
  );
}

"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * ポップアップチャット用のContext
 *
 * 設計判断:
 * - applicationId を「現在のページ文脈」として保持する。
 *   応募詳細ページに入ったとき SetPopupApplication が setCurrentApplication で
 *   セットし、離脱時にnullにする。これによりLauncherは「応募ページにいる時だけ
 *   表示」を実現できる。
 * - openForApplication は「ボタン押下などで明示的にポップアップを開く」用途。
 *   applicationId のセットと open を同時に行う。
 * - applicationId が切り替わったタイミングで conversationId をリセットする。
 *   別の応募に対して同じ会話を引きずらないようにするため(Phase 2 で
 *   applicationId → conversation の取得・作成を行う想定)。
 */

type PopupChatState = {
  isOpen: boolean;
  isMaximized: boolean;
  applicationId: string | null;
  conversationId: string | null;
};

type PopupChatActions = {
  openForApplication: (applicationId: string) => void;
  setCurrentApplication: (applicationId: string | null) => void;
  close: () => void;
  toggleMaximize: () => void;
  setConversationId: (id: string | null) => void;
};

type PopupChatContextValue = PopupChatState & PopupChatActions;

const PopupChatContext = createContext<PopupChatContextValue | null>(null);

export function PopupChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [conversationId, setConversationIdState] = useState<string | null>(null);

  // 「現在の応募ID」だけをセット(ポップアップは開かない)
  // 応募詳細ページの SetPopupApplication から呼ばれる
  const setCurrentApplication = useCallback((appId: string | null) => {
    setApplicationId((prev) => {
      // 応募が切り替わったら会話履歴コンテキストをリセット
      if (prev !== appId) {
        setConversationIdState(null);
      }
      return appId;
    });
    // ページから離脱したらポップアップ自体も閉じる
    if (appId === null) {
      setIsOpen(false);
      setIsMaximized(false);
    }
  }, []);

  // 応募IDを指定してポップアップを開く(明示的なアクション)
  const openForApplication = useCallback((appId: string) => {
    setApplicationId((prev) => {
      if (prev !== appId) {
        setConversationIdState(null);
      }
      return appId;
    });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setIsMaximized(false);
  }, []);

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const setConversationId = useCallback((id: string | null) => {
    setConversationIdState(id);
  }, []);

  const value: PopupChatContextValue = {
    isOpen,
    isMaximized,
    applicationId,
    conversationId,
    openForApplication,
    setCurrentApplication,
    close,
    toggleMaximize,
    setConversationId,
  };

  return <PopupChatContext.Provider value={value}>{children}</PopupChatContext.Provider>;
}

export function usePopupChat(): PopupChatContextValue {
  const ctx = useContext(PopupChatContext);
  if (!ctx) {
    throw new Error("usePopupChat must be used within PopupChatProvider");
  }
  return ctx;
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import type { ConversationListItem } from "@/lib/line/conversations";

import { ConversationListSidebar } from "./conversation-list-sidebar";

/**
 * pathname を 読み取って アクティブ な lineUserId を 抽出 し、
 * Conversation サイドバー に props 経由 で 渡す Client ラッパー。
 *
 * 加えて 5 秒 ごと の ポーリング + visibilitychange で 会話 一覧 を 更新
 * (新着 / 既読 / 並び替え を リアルタイム 風 に 反映)。
 */
type Props = { conversations: ConversationListItem[] };

const POLL_INTERVAL_MS = 5_000;

export function ActiveSync({ conversations: initial }: Props) {
  const pathname = usePathname();
  const m = pathname.match(/^\/agency\/line\/([^/]+)/);
  // route group "(conversations)" 等 の () 入り セグメント は active ID で ない
  const seg = m ? decodeURIComponent(m[1]) : null;
  const activeLineUserId = seg && !seg.startsWith("(") ? seg : null;

  const [conversations, setConversations] = useState<ConversationListItem[]>(initial);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();

    const poll = async () => {
      try {
        const res = await fetch("/api/agency/line/conversations", { signal: ctrl.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { conversations: ConversationListItem[] };
        if (active) setConversations(json.conversations);
      } catch {
        // 失敗 は サイレント (次回 試行)
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      active = false;
      ctrl.abort();
    };
  }, []);

  return (
    <ConversationListSidebar conversations={conversations} activeLineUserId={activeLineUserId} />
  );
}

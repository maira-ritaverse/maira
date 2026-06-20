"use client";

import { usePathname } from "next/navigation";

import type { ConversationListItem } from "@/lib/line/conversations";

import { ConversationListSidebar } from "./conversation-list-sidebar";

/**
 * pathname を 読み取って アクティブ な lineUserId を 抽出 し、
 * Conversation サイドバー に props 経由 で 渡す Client ラッパー。
 *
 * Server Layout から 直接 pathname を 知る 手段 が ない ため、 この 1 階層 だけ
 * Client Component を 挟む。 サイドバー 自体 は SSR の HTML を 受け取る。
 */
type Props = { conversations: ConversationListItem[] };

export function ActiveSync({ conversations }: Props) {
  const pathname = usePathname();
  // /agency/line/[lineUserId] から ID を 抽出
  const m = pathname.match(/^\/agency\/line\/([^/]+)/);
  const activeLineUserId = m ? decodeURIComponent(m[1]) : null;

  // 設定 / 一斉配信 / 友達一覧 ページ は active ID を 持たない (null) ので 全て 非選択

  return (
    <ConversationListSidebar conversations={conversations} activeLineUserId={activeLineUserId} />
  );
}

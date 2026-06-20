"use client";

import Link from "next/link";
import { useState } from "react";

import type { ConversationListItem } from "@/lib/line/conversations";

/**
 * LINE風 会話一覧 サイドバー (左カラム、 常時 表示)
 *
 * 上部 タブ:すべて / 要対応 / 対応済み
 *   - 要対応 = handled_at IS NULL
 *   - 対応済 = handled_at IS NOT NULL
 *
 * inbound メッセージ で 要対応 に 戻る (event-handler 内)
 * outbound 送信 で 対応済 に なる (送信 API 内)
 */
type Props = {
  conversations: ConversationListItem[];
  activeLineUserId: string | null;
};

type Tab = "all" | "needs_response" | "handled";

export function ConversationListSidebar({ conversations, activeLineUserId }: Props) {
  const [tab, setTab] = useState<Tab>("all");

  const filtered = conversations.filter((c) => {
    if (c.unfollowedAt) return tab === "all";
    if (tab === "needs_response") return c.handledAt === null;
    if (tab === "handled") return c.handledAt !== null;
    return true;
  });

  const needCount = conversations.filter((c) => c.handledAt === null && !c.unfollowedAt).length;
  const handledCount = conversations.filter((c) => c.handledAt !== null && !c.unfollowedAt).length;

  return (
    <aside className="flex h-full flex-col border-r bg-white">
      {/* ヘッダー + タブ */}
      <div className="border-b">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-sm font-semibold">すべて</span>
          <input
            type="search"
            placeholder="検索"
            className="ml-auto w-32 rounded-md border border-slate-200 px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            disabled
            aria-label="検索 (近日)"
          />
        </div>
        <div className="flex gap-1 border-t px-2 py-1.5">
          <TabBtn active={tab === "all"} onClick={() => setTab("all")}>
            すべて ({conversations.length})
          </TabBtn>
          <TabBtn active={tab === "needs_response"} onClick={() => setTab("needs_response")}>
            要対応 ({needCount})
          </TabBtn>
          <TabBtn active={tab === "handled"} onClick={() => setTab("handled")}>
            対応済 ({handledCount})
          </TabBtn>
        </div>
      </div>

      {/* 一覧 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground p-4 text-xs">
            {tab === "needs_response"
              ? "対応 が 必要 な トーク は ありません。"
              : tab === "handled"
                ? "対応済 の トーク は ありません。"
                : "まだ 友達 が いません。"}
          </p>
        ) : (
          <ul>
            {filtered.map((c) => {
              const active = activeLineUserId === c.lineUserId;
              return (
                <li key={c.lineUserId}>
                  <Link
                    href={`/agency/line/${encodeURIComponent(c.lineUserId)}`}
                    className={`flex gap-2.5 border-b border-slate-100 px-3 py-2.5 transition-colors ${
                      active ? "bg-emerald-50" : "hover:bg-slate-50"
                    }`}
                  >
                    {c.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.pictureUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full bg-slate-200 object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded-full bg-slate-200" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-1">
                        <p className="truncate text-sm font-medium">
                          {c.displayName ?? "(名前なし)"}
                        </p>
                        <span className="text-muted-foreground shrink-0 text-[10px]">
                          {c.lastMessageAt
                            ? new Date(c.lastMessageAt).toLocaleTimeString("ja-JP", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <p className="text-muted-foreground line-clamp-1 flex-1 text-xs">
                          {c.lastMessageDirection === "outbound" && (
                            <span className="mr-0.5 text-slate-400">あなた:</span>
                          )}
                          {c.lastMessagePreview ?? "(メッセージなし)"}
                        </p>
                        {c.unreadCount > 0 && (
                          <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                      {c.clientName && (
                        <p className="mt-0.5 truncate text-[10px] text-emerald-700">
                          紐付け: {c.clientName}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors ${
        active ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

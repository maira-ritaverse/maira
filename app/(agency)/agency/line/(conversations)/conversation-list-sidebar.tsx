"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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
  const [query, setQuery] = useState("");

  // C1-1 修正: 検索 は 表示 名 / 紐 付け 済 顧客 名 / 直近 メッセージ プレビュー
  // (復号 済) に 対して 部分 一致 で 行う。 空 白 で 区切った 複数 語 は AND 判定。
  // 顧客 名 は 個人 情報 だが、 検索 は クライアント側 のみ で 完結 (追加 の
  // ネットワーク 送信 なし) の ため、 既存 の 一覧 データ 上 の 絞り込み と 同 等 の 情報 経路。
  const normalizedQuery = query.trim().toLowerCase();
  const searchTokens = normalizedQuery.length > 0 ? normalizedQuery.split(/\s+/) : [];

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      // タブ フィルタ (unfollowed は 「すべて」 のみ 表示)
      if (c.unfollowedAt && tab !== "all") return false;
      if (tab === "needs_response" && c.handledAt !== null) return false;
      if (tab === "handled" && c.handledAt === null) return false;

      // 検索 フィルタ (トークン ALL 一致)
      if (searchTokens.length === 0) return true;
      const haystack = [c.displayName, c.clientName, c.lastMessagePreview]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(" ")
        .toLowerCase();
      return searchTokens.every((t) => haystack.includes(t));
    });
  }, [conversations, tab, searchTokens]);

  const needCount = conversations.filter((c) => c.handledAt === null && !c.unfollowedAt).length;
  const handledCount = conversations.filter((c) => c.handledAt !== null && !c.unfollowedAt).length;

  return (
    <aside className="flex h-full flex-col border-r bg-white">
      {/* ヘッダー + タブ */}
      <div className="border-b">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-sm font-semibold">すべて</span>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前 / 顧客 / 本文"
              className="w-40 rounded-md border border-slate-200 py-1 pr-6 pl-7 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              aria-label="会話 検索"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="検索 クリア"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
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
            {searchTokens.length > 0
              ? "検索 条件 に 一致 する トーク は ありません。"
              : tab === "needs_response"
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
                        {/* CRM 側で紐付けた顧客名を優先。 未紐付けの場合は LINE プロフィール名。 */}
                        <p className="truncate text-sm font-medium">
                          {c.clientName ?? c.displayName ?? "(名前なし)"}
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
                      {c.clientName && c.displayName && (
                        <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
                          LINE表示名: {c.displayName}
                        </p>
                      )}
                      {(() => {
                        // 3 日 連絡 なし の 赤 バッジ (handled 済み / ブロック 済み は 除外)
                        if (c.handledAt || c.unfollowedAt || !c.lastActivityAt) return null;
                        const days = Math.floor(
                          (Date.now() - new Date(c.lastActivityAt).getTime()) /
                            (1000 * 60 * 60 * 24),
                        );
                        if (days < 3) return null;
                        return (
                          <p className="mt-0.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                            {days}日 連絡 なし
                          </p>
                        );
                      })()}
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

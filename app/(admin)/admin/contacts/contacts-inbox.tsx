"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { RefreshButton } from "@/components/features/admin/refresh-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePersistedState } from "@/lib/admin/use-persisted-state";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Category = "signup_inquiry" | "general";
type CategoryFilter = "all" | "signup_inquiry" | "general";
type StatusLabel = "open" | "in_progress";
type StatusFilter = "all" | "in_progress";

const IN_PROGRESS_PREFIX = "[対応中]";

type Msg = {
  id: string;
  company: string;
  name: string;
  email: string;
  message: string;
  ipAddress: string | null;
  userAgent: string | null;
  readAt: string | null;
  notes: string | null;
  createdAt: string;
  category: Category;
  statusLabel: StatusLabel;
};

type ListResponse = {
  messages: Msg[];
  total: number;
  unreadCount: number;
};

type Filter = "unread" | "all";

/**
 * 受信箱インボックス。
 *
 * - フィルタ:未読のみ / 全件
 * - 各メッセージを展開 → メモ入力 + 既読切替
 * - 楽観的更新:ローカル state を即更新してから API
 */
export function ContactsInbox() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // フィルタ / カテゴリ / 検索ワードを永続化(画面遷移後も復元)
  const [filter, setFilter] = usePersistedState<Filter>("admin-contacts-filter", "unread");
  const [categoryFilter, setCategoryFilter] = usePersistedState<CategoryFilter>(
    "admin-contacts-category",
    "all",
  );
  const [statusFilter, setStatusFilter] = usePersistedState<StatusFilter>(
    "admin-contacts-status",
    "all",
  );
  const [query, setQuery] = usePersistedState("admin-contacts-q", "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMessages = async (f: Filter, c: CategoryFilter, s: StatusFilter, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ filter: f });
      if (c !== "all") params.set("category", c);
      if (s !== "all") params.set("status", s);
      if (q.trim().length > 0) params.set("q", q.trim());
      const res = await apiFetch<ListResponse>(`/api/admin/contacts?${params.toString()}`);
      setMessages(res?.messages ?? []);
      setUnreadCount(res?.unreadCount ?? 0);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // 永続化された filter / category / status / query を含めて debounce で取得
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchMessages(filter, categoryFilter, statusFilter, query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filter, categoryFilter, statusFilter, query]);

  const handleToggleRead = async (m: Msg) => {
    const next = m.readAt ? null : "now";
    // 楽観的更新
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id ? { ...x, readAt: next === "now" ? new Date().toISOString() : null } : x,
      ),
    );
    setUnreadCount((c) => c + (next === "now" ? -1 : 1));
    try {
      await apiFetch(`/api/admin/contacts`, {
        method: "PATCH",
        json: { id: m.id, readAt: next },
      });
    } catch (err) {
      setError(getErrorMessage(err));
      void fetchMessages(filter, categoryFilter, statusFilter, query);
    }
  };

  // 「対応中」のトグル:notes 先頭に [対応中] を付与/除去
  const handleToggleInProgress = async (m: Msg) => {
    const isInProgress = m.statusLabel === "in_progress";
    const trimmedNotes = (m.notes ?? "").replace(
      new RegExp(`^${IN_PROGRESS_PREFIX.replace(/[[\]]/g, "\\$&")}\\s*`),
      "",
    );
    const nextNotes = isInProgress ? trimmedNotes : `${IN_PROGRESS_PREFIX} ${trimmedNotes}`.trim();
    // 楽観的更新
    setMessages((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? {
              ...x,
              notes: nextNotes,
              statusLabel: isInProgress ? "open" : "in_progress",
            }
          : x,
      ),
    );
    try {
      await apiFetch(`/api/admin/contacts`, {
        method: "PATCH",
        json: { id: m.id, notes: nextNotes },
      });
    } catch (err) {
      setError(getErrorMessage(err));
      void fetchMessages(filter, categoryFilter, statusFilter, query);
    }
  };

  const handleSaveNotes = async (m: Msg, notes: string) => {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, notes } : x)));
    try {
      await apiFetch(`/api/admin/contacts`, {
        method: "PATCH",
        json: { id: m.id, notes },
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterTab
          active={filter === "unread"}
          onClick={() => setFilter("unread")}
          label={`未読 ${unreadCount}`}
        />
        <FilterTab active={filter === "all"} onClick={() => setFilter("all")} label="全件" />
        <span className="text-muted-foreground mx-1 text-xs">|</span>
        <FilterTab
          active={categoryFilter === "all"}
          onClick={() => setCategoryFilter("all")}
          label="種別すべて"
        />
        <FilterTab
          active={categoryFilter === "signup_inquiry"}
          onClick={() => setCategoryFilter("signup_inquiry")}
          label="新規導入"
        />
        <FilterTab
          active={categoryFilter === "general"}
          onClick={() => setCategoryFilter("general")}
          label="一般"
        />
        <span className="text-muted-foreground mx-1 text-xs">|</span>
        <FilterTab
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
          label="状態すべて"
        />
        <FilterTab
          active={statusFilter === "in_progress"}
          onClick={() => setStatusFilter("in_progress")}
          label="対応中"
        />
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="会社名 / 氏名 / メアド / 本文を検索…"
            className="max-w-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground text-xs underline"
            >
              クリア
            </button>
          )}
          <RefreshButton
            onClick={() => void fetchMessages(filter, categoryFilter, statusFilter, query)}
            loading={loading}
          />
        </div>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">読み込み中…</p>
      ) : messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {filter === "unread"
            ? "未読の問い合わせはありません。"
            : "問い合わせがまだ届いていません。"}
        </p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => {
            const expanded = expandedId === m.id;
            const isRead = !!m.readAt;
            return (
              <li
                key={m.id}
                className={`rounded border ${
                  isRead
                    ? "border-border"
                    : "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : m.id)}
                  className="hover:bg-accent/30 flex w-full items-start gap-2 p-3 text-left text-sm"
                >
                  <span className="text-xs">{expanded ? "▾" : "▸"}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <CategoryBadge category={m.category} />
                        {m.statusLabel === "in_progress" && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
                            対応中
                          </span>
                        )}
                        <span className="font-semibold">
                          {m.company} / {m.name}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-[10px]">
                        {new Date(m.createdAt).toLocaleString("ja-JP")}
                      </div>
                    </div>
                    <div className="text-muted-foreground text-xs">{m.email}</div>
                    {!expanded && (
                      <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {m.message}
                      </div>
                    )}
                  </div>
                  {!isRead && (
                    <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      未読
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="space-y-3 border-t p-3">
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-[10px]">本文</div>
                      <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <div className="text-muted-foreground">IP</div>
                        <div className="font-mono">{m.ipAddress ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">User-Agent</div>
                        <div className="font-mono break-all">{m.userAgent ?? "—"}</div>
                      </div>
                    </div>
                    <NotesEditor
                      initial={m.notes ?? ""}
                      onSave={(v) => void handleSaveNotes(m, v)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={isRead ? "outline" : "default"}
                        onClick={() => void handleToggleRead(m)}
                      >
                        {isRead ? "未読に戻す" : "既読にする"}
                      </Button>
                      <Button
                        size="sm"
                        variant={m.statusLabel === "in_progress" ? "default" : "outline"}
                        onClick={() => void handleToggleInProgress(m)}
                      >
                        {m.statusLabel === "in_progress" ? "対応中を解除" : "対応中にする"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href={`mailto:${m.email}?subject=Re%3A%20Maira%20%E3%81%B8%E3%81%AE%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B`}
                          >
                            メールで返信
                          </a>
                        }
                      >
                        メールで返信
                      </Button>
                      {m.category === "signup_inquiry" && (
                        <Button
                          size="sm"
                          render={
                            <Link
                              href={`/admin/organizations/new?company=${encodeURIComponent(m.company)}&email=${encodeURIComponent(m.email)}&fromContact=${m.id}`}
                            />
                          }
                        >
                          この企業を発行する →
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CategoryBadge({ category }: { category: Category }) {
  if (category === "signup_inquiry") {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        新規導入
      </span>
    );
  }
  return (
    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold">
      一般
    </span>
  );
}

function FilterTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent/50"
      }`}
    >
      {label}
    </button>
  );
}

function NotesEditor({ initial, onSave }: { initial: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[10px]">運営メモ(対応状況など)</div>
      <Textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        rows={2}
        maxLength={2000}
        placeholder="対応状況・引継ぎ事項など"
      />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onSave(value);
            setDirty(false);
          }}
        >
          メモを保存
        </Button>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "@/lib/api/client-fetch";

/**
 * 運営管理画面の Cmd+K コマンドパレット。
 *
 * UX:
 *   - Cmd+K(Mac)/ Ctrl+K(Win/Linux)でモーダルを開く
 *   - 検索 input は autoFocus、上から「ユーザ」「企業」の順で結果表示
 *   - ↑↓ で選択、Enter で遷移、Esc / 背景クリックで閉じる
 *   - 検索 200ms debounce(連打で過剰リクエストを防ぐ)
 *
 * 設計:
 *   - グローバル keydown listener はマウント中に常駐
 *   - 結果はサーバ /api/admin/search から取得(auth.users + organizations 横断)
 *   - 表示はフラット配列 + セクション見出し(キーボードナビ用の index 管理を単純化)
 */

type UserItem = { kind: "user"; id: string; email: string };
type OrgItem = { kind: "organization"; id: string; name: string };
type ContactItem = {
  kind: "contact";
  id: string;
  company: string;
  name: string;
  email: string;
};
type Item = UserItem | OrgItem | ContactItem;

type SearchResponse = {
  users: { id: string; email: string }[];
  organizations: { id: string; name: string }[];
  contacts: { id: string; company: string; name: string; email: string }[];
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>({
    users: [],
    organizations: [],
    contacts: [],
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== グローバルキー =====
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K でトグル
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 開閉時に input をクリア(意図しない遷移を防ぐ)。
  // setState を effect 内で直接呼ばないように microtask に逃がす。
  useEffect(() => {
    if (open) return;
    void Promise.resolve().then(() => {
      setQuery("");
      setResults({ users: [], organizations: [], contacts: [] });
      setActiveIdx(0);
    });
  }, [open]);

  // ===== 検索 =====
  // setState を effect 内で直接呼ばないために microtask + setTimeout 経由で
  // 状態更新する(react-hooks/set-state-in-effect 回避、共通パターン)。
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      void Promise.resolve().then(() => {
        setResults({ users: [], organizations: [], contacts: [] });
      });
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      apiFetch<SearchResponse>(`/api/admin/search?q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (res) setResults(res);
          setActiveIdx(0);
        })
        .catch(() => {
          // 失敗はサイレント(空のままにする)
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query]);

  // ===== フラット配列(キーボードナビ用) =====
  const items: Item[] = useMemo(() => {
    const users: UserItem[] = results.users.map((u) => ({
      kind: "user",
      id: u.id,
      email: u.email,
    }));
    const orgs: OrgItem[] = results.organizations.map((o) => ({
      kind: "organization",
      id: o.id,
      name: o.name,
    }));
    const contacts: ContactItem[] = results.contacts.map((c) => ({
      kind: "contact",
      id: c.id,
      company: c.company,
      name: c.name,
      email: c.email,
    }));
    return [...users, ...orgs, ...contacts];
  }, [results]);

  const goToItem = (item: Item) => {
    if (item.kind === "user") {
      router.push(`/admin/users`);
    } else if (item.kind === "organization") {
      router.push(`/admin/organizations/${item.id}`);
    } else {
      // 問い合わせは受信箱に飛ぶ(該当 ID へのディープリンクは UI 拡張余地)
      router.push(`/admin/contacts`);
    }
    setOpen(false);
  };

  // ===== モーダル内のキー操作 =====
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIdx];
      if (item) goToItem(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-200 flex items-start justify-center bg-black/40 p-4 pt-20"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-background w-full max-w-xl overflow-hidden rounded-lg border shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="border-b">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ユーザのメアド / 企業名で検索…"
            className="placeholder:text-muted-foreground w-full bg-transparent px-4 py-3 text-sm outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-xs">
              2 文字以上で検索開始
            </p>
          ) : loading && items.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-xs">検索中…</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-xs">該当なし</p>
          ) : (
            <Sections
              users={results.users}
              organizations={results.organizations}
              contacts={results.contacts}
              activeIdx={activeIdx}
              onSelect={goToItem}
            />
          )}
        </div>

        <div className="bg-muted/30 text-muted-foreground flex items-center justify-between border-t px-3 py-1.5 text-[10px]">
          <span>↑↓ で選択 / ⏎ で遷移</span>
          <span>Esc で閉じる</span>
        </div>
      </div>
    </div>
  );
}

function Sections({
  users,
  organizations,
  contacts,
  activeIdx,
  onSelect,
}: {
  users: { id: string; email: string }[];
  organizations: { id: string; name: string }[];
  contacts: { id: string; company: string; name: string; email: string }[];
  activeIdx: number;
  onSelect: (item: Item) => void;
}) {
  // フラット index は users → organizations → contacts の順に積み上がる。
  // render 中の変数再代入(immutability lint 抵触)を避けるため、
  // 各行で index を「親配列内インデックス + オフセット」で算出する。
  const orgOffset = users.length;
  const contactOffset = users.length + organizations.length;
  return (
    <div className="py-1">
      {users.length > 0 && (
        <div>
          <p className="text-muted-foreground px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
            ユーザ
          </p>
          {users.map((u, i) => {
            const active = i === activeIdx;
            const item: UserItem = { kind: "user", id: u.id, email: u.email };
            return (
              <ResultRow
                key={`u-${u.id}`}
                active={active}
                onClick={() => onSelect(item)}
                icon="👤"
                primary={u.email || "(no email)"}
                secondary={u.id}
              />
            );
          })}
        </div>
      )}

      {organizations.length > 0 && (
        <div>
          <p className="text-muted-foreground px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
            企業
          </p>
          {organizations.map((o, i) => {
            const flatIdx = orgOffset + i;
            const active = flatIdx === activeIdx;
            const item: OrgItem = { kind: "organization", id: o.id, name: o.name };
            return (
              <ResultRow
                key={`o-${o.id}`}
                active={active}
                onClick={() => onSelect(item)}
                icon="🏢"
                primary={o.name}
                secondary={o.id}
              />
            );
          })}
        </div>
      )}

      {contacts.length > 0 && (
        <div>
          <p className="text-muted-foreground px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
            問い合わせ
          </p>
          {contacts.map((c, i) => {
            const flatIdx = contactOffset + i;
            const active = flatIdx === activeIdx;
            const item: ContactItem = {
              kind: "contact",
              id: c.id,
              company: c.company,
              name: c.name,
              email: c.email,
            };
            return (
              <ResultRow
                key={`c-${c.id}`}
                active={active}
                onClick={() => onSelect(item)}
                icon="📨"
                primary={`${c.company} / ${c.name}`}
                secondary={c.email}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  icon,
  primary,
  secondary,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  primary: string;
  secondary: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
        active ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <span aria-hidden className="text-base">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{primary}</p>
        <p className="text-muted-foreground truncate text-[10px]">{secondary}</p>
      </div>
      {active && (
        <span aria-hidden className="text-muted-foreground text-xs">
          ⏎
        </span>
      )}
    </button>
  );
}

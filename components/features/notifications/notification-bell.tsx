"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * アプリ内通知ベル(エージェント側ヘッダーに差し込む)
 *
 * 取得方式:
 *   - マウント時に GET /api/notifications で最新30件を取得(本文は復号済)
 *   - GET /api/notifications/unread-count を 45 秒間隔でポーリング(軽量)
 *   - ベルを開いた時にも本文を再取得(タブ復帰後すぐ最新を見せる)
 *   - Realtime は今回不採用(Phase 2)
 *
 * 既読化:
 *   - 行クリックで POST /api/notifications/[id]/read
 *   - 楽観的に local state を即更新(read_at を埋める + unreadCount を-1)
 *     API 失敗時は元に戻す(下流の整合性は次回 GET で取り直す)
 *
 * エラー時の方針:
 *   - 取得失敗は静かにフォールバック(ベルは表示するが空状態へ)。
 *     ベル UI が壊れてもアプリ本体は動くべき。
 */

type NotificationPayload = {
  kind?: string;
  title?: string;
  href?: string;
} & Record<string, unknown>;

type NotificationItem = {
  id: string;
  kind: string;
  channel: string;
  readAt: string | null;
  createdAt: string;
  payload: NotificationPayload | null;
};

// ポーリング 間隔 を 30 秒 に 短縮 (旧 45 秒)。 加えて visibilitychange で
// タブ 復帰 時 に 即時 再取得 する。 これ で 「新着 が 遅れて 気づく」 曖昧 さ を 解消。
const POLL_INTERVAL_MS = 30_000;

/**
 * 内部状態の単一化:items / unreadCount / hasLoaded を 1 つのオブジェクトに
 * まとめる。理由:
 *   - useEffect 中の setState は同期だと react-hooks/set-state-in-effect で
 *     警告される。await の後にだけ setState する形で書きたいが、複数の
 *     useState だと忘れやすい。1 つのオブジェクトにまとめて単一の setData
 *     経由で更新することで、フェッチ完了後の 1 行更新に集約できる。
 *   - hasLoaded(初回取得が終わったか)はスケルトン表示の出し分けに使う。
 */
type ListState = {
  items: NotificationItem[];
  hasLoaded: boolean;
};

export function NotificationBell() {
  const [list, setList] = useState<ListState>({ items: [], hasLoaded: false });
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState(false);

  // 初回:本文 + 未読数。以降:未読数だけポーリング。
  // popup-chat-window と同じく、関数を useEffect 内で定義して呼ぶ形にする。
  // 外部 useCallback 経由だと react-hooks/set-state-in-effect が
  // 「effect 内から setState する関数を sync で呼んでいる」と判定するため。
  useEffect(() => {
    let cancelled = false;

    const loadList = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setList((prev) => ({ items: prev.items, hasLoaded: true }));
          return;
        }
        const data = (await res.json()) as { notifications: NotificationItem[] };
        if (cancelled) return;
        setList({ items: data.notifications ?? [], hasLoaded: true });
      } catch {
        if (!cancelled) setList((prev) => ({ items: prev.items, hasLoaded: true }));
      }
    };

    const loadCount = async () => {
      try {
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { count: number };
        if (cancelled) return;
        setUnreadCount(typeof data.count === "number" ? data.count : 0);
      } catch {
        // 静かに失敗
      }
    };

    loadList();
    loadCount();
    const interval = setInterval(loadCount, POLL_INTERVAL_MS);

    // タブ が フォアグラウンド に 戻った / focus が 復帰 した 際 に 即時 未読数 再取得。
    // 数 分 タブ を 離れた 後 の 「新着 バッジ が すぐ 出る」 UX を 実現。
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadCount();
        void loadList();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  // ベルを開いたタイミングで本文を再取得(タブを長時間放置している場合に有効)。
  // ここも同じく useEffect 内で関数を定義してから呼ぶ。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const reloadList = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { notifications: NotificationItem[] };
        if (cancelled) return;
        setList({ items: data.notifications ?? [], hasLoaded: true });
      } catch {
        // 静かに失敗(既に表示中のリストを残す)
      }
    };

    reloadList();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 失敗時のフォールバック用に未読数を取り直す関数(markAsRead から呼ぶ)
  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { count: number };
      setUnreadCount(typeof data.count === "number" ? data.count : 0);
    } catch {
      // 静かに失敗
    }
  }, []);

  // 全既読化(楽観的更新 + 失敗時は再取得で整合性回復)
  const markAllAsRead = useCallback(async () => {
    // 楽観的:すべての 行 を 既読 に + バッジ 0 へ
    const nowIso = new Date().toISOString();
    setList((current) => ({
      items: current.items.map((it) => (it.readAt ? it : { ...it, readAt: nowIso })),
      hasLoaded: current.hasLoaded,
    }));
    setUnreadCount(0);

    try {
      const res = await fetch("/api/notifications/mark-all-read", { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch {
      // 失敗時は サーバ から 整合性 を 取り直す
      void refreshUnreadCount();
    }
  }, [refreshUnreadCount]);

  // 個別既読化(楽観的更新 + 失敗時は再取得で整合性回復)
  const markAsRead = useCallback(
    async (id: string) => {
      let wasUnread = false;

      // setList updater 内で「未読だったか」を判定 & ローカル状態を更新
      setList((current) => {
        const target = current.items.find((it) => it.id === id);
        if (!target || target.readAt) return current;
        wasUnread = true;
        const nowIso = new Date().toISOString();
        return {
          items: current.items.map((it) => (it.id === id ? { ...it, readAt: nowIso } : it)),
          hasLoaded: current.hasLoaded,
        };
      });

      // 同フレームの状態に頼らず、wasUnread フラグだけでバッジを 1 減らす
      if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));

      // 既に既読だった行は API も叩かない(read_at の上書きを避ける)
      if (!wasUnread) return;

      try {
        const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
        if (!res.ok) throw new Error(`status ${res.status}`);
      } catch {
        // 完全ロールバックは複雑なので、未読数だけサーバから取り直して整合性を回復。
        // 行の readAt は UI 上のままにする(画面遷移済の可能性が高いため)。
        void refreshUnreadCount();
      }
    },
    [refreshUnreadCount],
  );

  const hasUnread = unreadCount > 0;

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "relative h-9 w-9 transition-all",
              // 未読 あり: 少し 目立つ 背景 + active 時 の 押し込み
              hasUnread
                ? "text-red-600 hover:bg-red-50 hover:text-red-700 active:scale-95"
                : "hover:bg-accent active:scale-95",
            )}
            aria-label={hasUnread ? `通知 ${unreadCount}件の未読` : "通知"}
            title={hasUnread ? `未読 ${unreadCount} 件` : "通知"}
          >
            {hasUnread ? (
              // BellRing = 音符 付き の ベル で 「新着 あり」 を 視覚 的 に 明示
              <BellRing className="h-5 w-5" aria-hidden strokeWidth={2.5} />
            ) : (
              <Bell className="h-5 w-5" aria-hidden />
            )}
            {hasUnread && (
              <span
                className={cn(
                  "absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center",
                  "rounded-full bg-red-600 px-1.5 text-[11px] leading-none font-bold text-white tabular-nums",
                  "shadow-sm ring-2 ring-white",
                  // 開いて い ない 時 だけ 静か に 脈打つ (開いた 状態 の 気 散らし を 防ぐ)
                  !isOpen && "animate-pulse",
                )}
                aria-hidden
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        }
      />

      <DropdownMenuContent align="end" sideOffset={6} className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-baseline gap-2">
            <p className="text-sm font-semibold">通知</p>
            {unreadCount > 0 && (
              <span className="text-muted-foreground text-xs">未読 {unreadCount} 件</span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              className="text-primary hover:text-primary/80 text-xs font-medium underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              すべて 既読
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {!list.hasLoaded ? (
            <NotificationsSkeleton />
          ) : list.items.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-border divide-y">
              {list.items.map((item) => (
                <NotificationRow key={item.id} item={item} onActivate={markAsRead} />
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
  item,
  onActivate,
}: {
  item: NotificationItem;
  onActivate: (id: string) => void;
}) {
  const isUnread = !item.readAt;
  const href = (item.payload?.href as string | undefined) ?? null;
  const title = (item.payload?.title as string | undefined) ?? "(本文を読み込めませんでした)";
  const relative = formatRelativeJa(item.createdAt);

  const content = (
    <div className="flex items-start gap-2">
      {/* 未読インジケータ(視覚補助。スクリーンリーダーには aria-label で別途伝える) */}
      <span
        className={cn(
          "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
          isUnread ? "bg-primary" : "bg-transparent",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-2 text-sm",
            isUnread ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          {title}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">{relative}</p>
      </div>
    </div>
  );

  const aria = isUnread ? "未読の通知:" : "既読の通知:";

  // href がある場合は Link、無い場合は button(クリックで既読化のみ)。
  return (
    <li className={cn("hover:bg-accent/50 transition-colors", isUnread && "bg-accent/20")}>
      {href ? (
        <Link
          href={href}
          aria-label={`${aria}${(item.payload?.title as string | undefined) ?? ""}`}
          onClick={() => onActivate(item.id)}
          className="focus-visible:ring-ring block px-3 py-2.5 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={`${aria}${(item.payload?.title as string | undefined) ?? ""}`}
          onClick={() => onActivate(item.id)}
          className="focus-visible:ring-ring block w-full px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          {content}
        </button>
      )}
    </li>
  );
}

function EmptyState() {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-1 px-3 py-8 text-center text-sm">
      <Bell className="h-5 w-5 opacity-50" aria-hidden />
      <p>通知はありません</p>
    </div>
  );
}

function NotificationsSkeleton() {
  return (
    <ul className="divide-border divide-y" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="bg-muted mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="bg-muted h-3.5 w-4/5 rounded" />
              <div className="bg-muted h-3 w-1/3 rounded" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 相対時刻の日本語整形(依存追加せず最小実装)。
 * 既存に共通ヘルパーが無いため、ベル内で完結させる。
 * 1 週間以上前は yyyy/MM/dd 表記にフォールバック(粒度の細かさより視認性優先)。
 */
function formatRelativeJa(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const ms = Date.now() - t;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

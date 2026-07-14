"use client";

/**
 * 求職者向け モバイル ナビゲーション ドロワー
 *
 * 背景:
 *   デスクトップ 用 sidebar (customizable-sidebar.tsx) は `hidden md:flex` で
 *   モバイル で 完全 非表示 だった。 header に も ナビ 手段 が なく、
 *   スマホ で 詳細 ページ に 入る と ダッシュボード / 求人 / 応募 等 に
 *   戻る 手段 が 一切 無かった (P0 UX bug)。
 *
 * 設計:
 *   ・md 未満 の 端末 で だけ 表示 する ハンバーガー ボタン + ドロワー
 *   ・sidebar を そのまま 開閉 する の で は なく、 mobile 専用 に シンプル な
 *     リスト を レンダ (drag/drop カスタマイズ は mobile で は 不要)
 *   ・SEEKER_NAV_ITEMS を app-sidebar.tsx から 単一 の 真実 と して 共有
 *   ・route 遷移 時 に 自動 で 閉じる (usePathname が 変わる たび)
 *   ・背景 タップ / Esc / X ボタン で 閉じる
 */
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { NavIcon } from "@/lib/ui/nav-icon";
import { SEEKER_NAV_ITEMS } from "./app-sidebar";

type Props = {
  /** 「エージェント連携」 に 表示 する 招待 数 バッジ (invitedCount) */
  invitedCount?: number;
};

export function MobileNavDrawer({ invitedCount = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 画面 遷移 (Link クリック) で 自動 close する ため、 各 Link の onClick で 閉じる。
  // useEffect + pathname 監視 も 手 だ が react-hooks/set-state-in-effect に 引っ掛かる。
  // Link の onClick は 遷移 前 に 発火 する ので、 遷移 完了 と 同時 に 閉じる 挙動 に なる。

  // Esc キー で 閉じる (a11y)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <>
      {/* ハンバーガー ボタン (md 未満 のみ)。 header の 左端 に 置く 想定。 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ナビゲーションを開く"
        className="hover:bg-accent -m-2 rounded p-2 md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        >
          <div
            className="bg-card fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85%] flex-col border-r p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="ナビゲーション"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-semibold">メニュー</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="text-muted-foreground hover:text-foreground -m-2 rounded p-2"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto">
              {SEEKER_NAV_ITEMS.map((item) => {
                const active = isActive(item.href);
                // エージェント連携 だけ 招待 数 を バッジ 表示
                const badge = item.id === "connections" && invitedCount > 0 ? invitedCount : null;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-accent"
                    }`}
                  >
                    <NavIcon name={item.icon} className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.defaultLabel}</span>
                    {badge != null && (
                      <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

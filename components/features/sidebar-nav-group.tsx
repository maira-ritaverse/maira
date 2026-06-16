"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { NavIcon } from "@/lib/ui/nav-icon";

/**
 * サイドバーのナビゲーション項目。
 *
 * SidebarLink:単独のトップレベル項目(グループに入れない通常リンク)
 * SidebarNavGroup:複数の関連項目をまとめた折りたたみグループ(2 件以上で使う)
 */

export type SidebarItem = {
  href: string;
  icon: string;
  label: string;
  isActive?: boolean;
  badge?: number;
  dataAttr?: string;
};

const linkClass = (active: boolean): string =>
  // 通常時:base 14px → 求めに応じて 15px に少し大きく
  // icon と label に十分なスペース。アクティブ時は primary 色で塗りつぶし。
  `flex items-center gap-3 rounded-md px-3 py-2 text-[15px] font-medium transition-colors ${
    active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
  }`;

/**
 * トップレベルの単独リンク(グループ化しない項目向け)
 */
export function SidebarLink({ item }: { item: SidebarItem }) {
  return (
    <Link
      href={item.href}
      data-tour={item.dataAttr}
      aria-current={item.isActive ? "page" : undefined}
      className={linkClass(!!item.isActive)}
    >
      <NavIcon name={item.icon} className="size-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <Badge active={!!item.isActive} count={item.badge} />
      )}
    </Link>
  );
}

type GroupProps = {
  groupId: string;
  storageKeyPrefix: string;
  title: string;
  items: SidebarItem[];
};

/**
 * 2 件以上の関連項目をまとめる折りたたみグループ
 *
 * - グループタイトルクリックで折りたたみ / 展開
 * - localStorage に per-group で永続化
 * - デフォルトは「折りたたみ」(視覚ノイズ低減、ユーザ主導で開く運用)
 * - ただしグループ内に active な項目があれば自動展開(現在地を埋もれさせない)
 * - ユーザが明示的に開いた状態は localStorage で永続化
 * - 折りたたみ中でもタイトル色が active 状態を示す
 * - グループ自体はアイコンを持たない(視覚ノイズ低減、項目アイコンに集中)
 */
export function SidebarNavGroup({ groupId, storageKeyPrefix, title, items }: GroupProps) {
  const anyActive = items.some((i) => i.isActive);

  // 初期 expanded:active 項目を含む場合のみ true、それ以外はデフォルト折りたたみ。
  // anyActive は items の URL から決まるので SSR / CSR で一致 → hydration mismatch なし。
  const [expanded, setExpanded] = useState(anyActive);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void Promise.resolve().then(() => {
      // active 中のグループは常に展開のままにする(localStorage より優先)
      if (anyActive) return;
      try {
        const raw = localStorage.getItem(`${storageKeyPrefix}:${groupId}:expanded`);
        // ユーザが明示的に開いた状態のみ復元。未保存 or "false" はデフォルト=折りたたみ。
        if (raw === "true") setExpanded(true);
      } catch {
        /* private mode etc. */
      }
    });
  }, [storageKeyPrefix, groupId, anyActive]);

  const toggle = () => {
    setExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(`${storageKeyPrefix}:${groupId}:expanded`, String(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={toggle}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors ${
          anyActive
            ? "text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        }`}
        aria-expanded={expanded}
        aria-controls={`group-${groupId}`}
      >
        <span className="flex-1 text-left">{title}</span>
        <span aria-hidden className="text-xs">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <ul id={`group-${groupId}`} className="space-y-0.5 pl-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                data-tour={item.dataAttr}
                aria-current={item.isActive ? "page" : undefined}
                className={linkClass(!!item.isActive)}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <Badge active={!!item.isActive} count={item.badge} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({ active, count }: { active: boolean; count: number }) {
  return (
    <span
      aria-label={`${count}件`}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
        active
          ? "bg-primary-foreground/20 text-primary-foreground"
          : "bg-primary text-primary-foreground"
      }`}
    >
      {count}
    </span>
  );
}

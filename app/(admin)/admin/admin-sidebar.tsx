"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 運営管理画面のサイドナビ(Client Component)。
 *
 * Server Component の layout から現在パスが取れないため、ナビ部分は別 Client にする。
 * 全体のレイアウト(grid)は layout.tsx 側が握る。
 *
 * UX 設計:
 *   - 左固定 240px、メイン領域は flex-1 で画面いっぱい
 *   - 未読バッジは「問い合わせ」だけ表示(他は今のところ不要)
 *   - 現在ページは琥珀色のハイライト(運営画面のテーマカラー)
 */

type NavItem = {
  href: string;
  icon: string;
  label: string;
  /** 完全一致だけでなく前方一致でも active にする(詳細ページ等を吸収) */
  prefix?: boolean;
};

type NavSection = {
  /** セクション見出し。null ならヘッダー無し(ホーム単独などに使う) */
  title: string | null;
  items: NavItem[];
};

/**
 * セクション分けの方針:
 *   - 顧客管理:日常運用で最もよく使う(契約者/利用者の状況)
 *   - データ分析:数字を見るためのページ
 *   - システム:法令対応 / 通知などインフラ的なもの
 * 項目が増えても破綻しないよう、最初から固定の 3 セクションを用意。
 */
const SECTIONS: NavSection[] = [
  {
    title: null,
    items: [{ href: "/admin", icon: "🏠", label: "ホーム" }],
  },
  {
    title: "顧客管理",
    items: [
      { href: "/admin/users", icon: "👥", label: "ユーザ", prefix: true },
      { href: "/admin/organizations", icon: "🏢", label: "企業", prefix: true },
      { href: "/admin/contacts", icon: "📨", label: "問い合わせ", prefix: true },
      { href: "/admin/roi-leads", icon: "📈", label: "ROI 試算 リード", prefix: true },
    ],
  },
  {
    title: "データ分析",
    items: [
      { href: "/admin/ai-usage", icon: "⚡", label: "AI 利用量", prefix: true },
      { href: "/admin/payments", icon: "💴", label: "課金 / 売上", prefix: true },
      { href: "/admin/kpi", icon: "📊", label: "KPI", prefix: true },
    ],
  },
  {
    title: "システム",
    items: [
      { href: "/admin/audit-logs", icon: "📜", label: "監査ログ", prefix: true },
      { href: "/admin/announcements", icon: "📣", label: "お知らせ", prefix: true },
    ],
  },
];

export function AdminSidebar({
  userEmail,
  unreadContacts,
}: {
  userEmail: string;
  unreadContacts: number;
}) {
  const pathname = usePathname();

  const isActive = (item: NavItem): boolean => {
    if (item.prefix) {
      return pathname === item.href || pathname.startsWith(`${item.href}/`);
    }
    return pathname === item.href;
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-amber-50/40 dark:bg-amber-950/20">
      <div className="border-b border-amber-200/60 p-4 dark:border-amber-900/60">
        <Link href="/admin" className="block text-sm font-bold text-amber-900 dark:text-amber-100">
          🛡 Maira 運営管理
        </Link>
        <p className="mt-0.5 text-[10px] text-amber-700/70 dark:text-amber-300/70">
          Operations Console
        </p>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto p-2">
        {SECTIONS.map((section, sectionIdx) => (
          <div key={section.title ?? `__top-${sectionIdx}`} className="space-y-0.5">
            {section.title && (
              <p className="px-3 pt-2 text-[10px] font-semibold tracking-wider text-amber-700/70 uppercase dark:text-amber-300/70">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const active = isActive(item);
              const badge = item.href === "/admin/contacts" ? unreadContacts : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-amber-200/60 font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100"
                      : "text-amber-900/80 hover:bg-amber-100/60 dark:text-amber-200/80 dark:hover:bg-amber-900/30"
                  }`}
                >
                  <span aria-hidden className="text-base">
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge > 0 && (
                    <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-amber-200/60 p-3 dark:border-amber-900/60">
        <div>
          <p className="text-[10px] font-medium text-amber-900/80 dark:text-amber-200/80">
            ログイン中
          </p>
          <p className="truncate text-xs text-amber-900 dark:text-amber-100">{userEmail}</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-amber-200/60 bg-white/40 px-2 py-1.5 text-[10px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <kbd className="rounded border border-amber-300 bg-amber-100/80 px-1 py-0.5 font-mono text-[9px] dark:border-amber-800 dark:bg-amber-900/60">
            ⌘K
          </kbd>
          <span>でユーザ / 企業を検索</span>
        </div>
      </div>
    </aside>
  );
}

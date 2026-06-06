"use client";

import Link from "next/link";

const navItems = [
  { href: "/app", label: "ダッシュボード", icon: "📊" },
  // キャリア診断は棚卸しの「方向決め」役。棚卸しの前に置いて自然な導線にする。
  { href: "/app/diagnosis", label: "キャリア診断", icon: "🧭" },
  { href: "/app/career", label: "キャリア棚卸し", icon: "💬" },
  { href: "/app/documents", label: "書類作成", icon: "📝" },
  { href: "/app/resumes", label: "履歴書", icon: "📄" },
  { href: "/app/cvs", label: "職務経歴書", icon: "📑" },
  { href: "/app/applications", label: "応募管理", icon: "📋" },
];

// オンボーディングツアーで個別ハイライトしたいナビ項目に data-tour 属性を割り当てるための対応表。
// 該当しない項目は undefined を返し、属性そのものが付かないようにする。
function getTourAttr(href: string): string | undefined {
  if (href === "/app/career") return "nav-career";
  if (href === "/app/documents") return "nav-documents";
  return undefined;
}

export function AppSidebar() {
  return (
    <aside data-tour="sidebar" className="bg-card hidden w-60 flex-col border-r p-4 md:flex">
      <div className="mb-6">
        <Link href="/app" className="text-xl font-bold">
          Maira
        </Link>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-tour={getTourAttr(item.href)}
            className="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="text-muted-foreground mt-auto pt-4 text-xs">Plan: Free(開発中)</div>
    </aside>
  );
}

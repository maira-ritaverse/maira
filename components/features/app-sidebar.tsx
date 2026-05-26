"use client";

import Link from "next/link";

const navItems = [
  { href: "/app", label: "ダッシュボード", icon: "📊" },
  { href: "/app/test-chat", label: "AI動作確認", icon: "🤖" },
  { href: "/app/career", label: "キャリア棚卸し", icon: "💬" },
  { href: "/app/documents", label: "書類作成", icon: "📝" },
  { href: "/app/applications", label: "応募管理", icon: "📋", disabled: true },
];

export function AppSidebar() {
  return (
    <aside className="bg-card hidden w-60 flex-col border-r p-4 md:flex">
      <div className="mb-6">
        <Link href="/app" className="text-xl font-bold">
          Maira
        </Link>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.disabled ? "#" : item.href}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              item.disabled
                ? "text-muted-foreground cursor-not-allowed opacity-50"
                : "hover:bg-accent"
            }`}
            onClick={item.disabled ? (e) => e.preventDefault() : undefined}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
            {item.disabled && <span className="text-muted-foreground ml-auto text-xs">準備中</span>}
          </Link>
        ))}
      </nav>

      <div className="text-muted-foreground mt-auto pt-4 text-xs">Plan: Free(開発中)</div>
    </aside>
  );
}

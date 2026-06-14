"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OrganizationRole } from "@/lib/organizations/types";

/**
 * エージェント企業メンバー向けのサイドバー
 *
 * 求職者向け AppSidebar とは別物。将来的な機能追加(求人管理、マッチング等)を
 * 想定して navItems を中央集約しておく。
 */

type Props = {
  organizationName: string;
  memberRole: OrganizationRole;
};

type NavItem = {
  href: string;
  icon: string;
  label: string;
  // 表示に必要なロール。未指定なら全メンバーに表示。
  requiredRole?: OrganizationRole;
};

const navItems: NavItem[] = [
  { href: "/agency/clients", icon: "👥", label: "クライアント管理" },
  { href: "/agency/jobs", icon: "💼", label: "求人管理" },
  { href: "/agency/reports", icon: "📊", label: "レポート" },
  // マーケティング(MA)は β機能。advisor も閲覧可。配信制御は admin のみ(画面/API側で判定)。
  { href: "/agency/marketing", icon: "📣", label: "マーケティング" },
  // メンバー管理は admin 専用(サーバー側でも /agency/members を redirect)
  { href: "/agency/members", icon: "⚙️", label: "メンバー管理", requiredRole: "admin" },
  // 将来追加予定:
  // { href: "/agency/matching", icon: "🔗", label: "マッチング" },
];

export function AgencySidebar({ organizationName, memberRole }: Props) {
  const pathname = usePathname();

  return (
    <aside className="bg-card hidden w-60 shrink-0 flex-col border-r p-4 md:flex">
      <div className="mb-6">
        <p className="text-muted-foreground text-xs">エージェント管理</p>
        <p className="truncate font-bold">{organizationName}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {memberRole === "admin" ? "管理者" : "アドバイザー"}
        </p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          // ロール要件を満たさない項目は出さない(admin 専用メニュー等)
          if (item.requiredRole && item.requiredRole !== memberRole) return null;
          // 完全一致ではなく前方一致で判定(/agency/clients/[id] でもアクティブにする)
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="text-muted-foreground mt-auto pt-4 text-xs">エージェント版(β)</div>
    </aside>
  );
}

"use client";

import Link from "next/link";

const navItems = [
  { href: "/app", label: "ダッシュボード", icon: "📊" },
  // キャリア診断は棚卸しの「方向決め」役。棚卸しの前に置いて自然な導線にする。
  { href: "/app/diagnosis", label: "キャリア診断", icon: "🧭" },
  { href: "/app/career", label: "キャリア棚卸し", icon: "💬" },
  { href: "/app/documents", label: "志望動機・自己PR", icon: "📝" },
  { href: "/app/resumes", label: "履歴書", icon: "📄" },
  { href: "/app/cvs", label: "職務経歴書", icon: "📑" },
  { href: "/app/applications", label: "応募管理", icon: "📋" },
  // エージェントとの連携状態(招待承認・連携解除)を一元管理するハブ。
  // 招待件数(invitedCount)が 1 以上のときバッジで気付かせる。
  { href: "/app/connections", label: "エージェント連携", icon: "🔗" },
];

// オンボーディングツアーで個別ハイライトしたいナビ項目に data-tour 属性を割り当てるための対応表。
// 該当しない項目は undefined を返し、属性そのものが付かないようにする。
function getTourAttr(href: string): string | undefined {
  if (href === "/app/career") return "nav-career";
  if (href === "/app/documents") return "nav-documents";
  return undefined;
}

type Props = {
  // 受信中の招待件数。バッジ表示用。0 のときはバッジ非表示。
  // Server Component の layout から渡す(本コンポーネントは "use client" のため
  // 自前で fetch せず props に倒している)。
  invitedCount?: number;
};

export function AppSidebar({ invitedCount = 0 }: Props) {
  return (
    <aside data-tour="sidebar" className="bg-card hidden w-60 flex-col border-r p-4 md:flex">
      <div className="mb-6">
        <Link href="/app" className="text-xl font-bold">
          Maira
        </Link>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const showBadge = item.href === "/app/connections" && invitedCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-tour={getTourAttr(item.href)}
              className="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
            >
              <span>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span
                  aria-label={`未対応の招待が${invitedCount}件あります`}
                  className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
                >
                  {invitedCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="text-muted-foreground mt-auto pt-4 text-xs">Plan: Free(開発中)</div>
    </aside>
  );
}

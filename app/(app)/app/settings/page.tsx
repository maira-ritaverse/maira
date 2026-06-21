import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  GraduationCap,
  Lock,
  type LucideIcon,
  Sparkles,
  User,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { listSeekerAiUsageOverview } from "@/lib/seeker/ai-usage-overview";
import { createClient } from "@/lib/supabase/server";

/**
 * 設定 トップ ページ (求職者 / seeker)
 *
 * 構成:
 *   1. PageHeading
 *   2. AI 利用 残数 オーバービュー カード (= 一番 価値 ある 情報、 トップ)
 *   3. 各 設定 カテゴリ メニュー
 *
 * 認証 は middleware と layout で ガード 済 だが 防御 的 に 再 チェック。
 * AI 残数 は ユーザー の 操作 で 頻繁 に 変わる ため force-dynamic + revalidate=0。
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const aiUsage = await listSeekerAiUsageOverview(supabase, user.id);

  const menuItems: Array<{
    href: string;
    Icon: LucideIcon;
    title: string;
    description: string;
  }> = [
    {
      href: "/app/settings/profile",
      Icon: User,
      title: "プロフィール",
      description: "表示名 などの 基本 情報",
    },
    {
      href: "/app/settings/password",
      Icon: Lock,
      title: "パスワード",
      description: "ログイン パスワード の 変更",
    },
    {
      href: "/app/settings/onboarding",
      Icon: GraduationCap,
      title: "オンボーディング ツアー",
      description: "Maira の 使い方 ツアー を 再 表示",
    },
    {
      href: "/app/settings/integrations",
      Icon: BarChart3,
      title: "連携・利用 状況",
      description: "Zoom / Google 連携、 ブースト チケット、 詳細 な 利用 履歴",
    },
    {
      href: "/app/settings/account",
      Icon: AlertTriangle,
      title: "アカウント",
      description: "登録 メアド の 確認 / アカウント の 削除",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeading
        title="設定"
        description="アカウント 情報 や 今月 の AI 利用 残数 を 確認 でき ます"
      />

      {/* AI 利用 残数 (今月) */}
      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="text-muted-foreground size-4" aria-hidden />
          <h2 className="text-sm font-semibold">今月 の AI 利用 残数</h2>
          <span className="text-muted-foreground text-[10px]">翌月 1 日 リセット</span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {aiUsage.map((row) => {
            const pct = row.limit > 0 ? Math.min(100, (row.current / row.limit) * 100) : 0;
            const lowRemaining =
              !row.unavailable && row.limit > 0 && row.remaining <= Math.max(1, row.limit * 0.1);
            return (
              <li key={row.kind} className="space-y-1 rounded-md border p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">{row.label}</span>
                  {row.unavailable ? (
                    <span className="text-muted-foreground text-[10px]">
                      ご利用 いただけ ません
                    </span>
                  ) : (
                    <span className="font-mono text-[11px]">
                      残{" "}
                      <span className={lowRemaining ? "font-bold text-red-600" : ""}>
                        {row.remaining}
                      </span>{" "}
                      / {row.limit}
                    </span>
                  )}
                </div>
                {!row.unavailable && (
                  <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                    <div
                      className={`h-full transition-all ${
                        row.remaining === 0
                          ? "bg-red-500"
                          : lowRemaining
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="space-y-2">
        {menuItems.map((item) => (
          <Card key={item.href} className="py-0">
            <Link
              href={item.href}
              className="hover:bg-accent flex items-center gap-4 p-4 transition-colors"
            >
              <item.Icon className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.title}</p>
                <p className="text-muted-foreground text-sm">{item.description}</p>
              </div>
              <ChevronRight className="text-muted-foreground size-4" aria-hidden />
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

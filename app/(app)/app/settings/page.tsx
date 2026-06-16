import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  GraduationCap,
  Lock,
  type LucideIcon,
  User,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

/**
 * 設定トップページ
 *
 * 各設定カテゴリへの導線を並べるだけのメニュー。
 * 認証は middleware と layout でガード済みだが、防御的に再チェック。
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

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
      description: "表示名などの基本情報",
    },
    {
      href: "/app/settings/password",
      Icon: Lock,
      title: "パスワード",
      description: "ログインパスワードの変更",
    },
    {
      href: "/app/settings/onboarding",
      Icon: GraduationCap,
      title: "オンボーディングツアー",
      description: "Mairaの使い方ツアーを再表示",
    },
    {
      href: "/app/settings/integrations",
      Icon: BarChart3,
      title: "AI 利用状況",
      description: "今月の AI ヒアリング・証明写真・求人推薦の利用回数",
    },
    {
      href: "/app/settings/account",
      Icon: AlertTriangle,
      title: "アカウント",
      description: "登録メアドの確認 / アカウントの削除",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="text-muted-foreground mt-1 text-sm">アカウント情報やプロフィールの管理</p>
      </div>

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

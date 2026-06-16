import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { AccountDeleteSection } from "./account-delete-section";
import { AccountExportSection } from "./account-export-section";

/**
 * アカウント設定ページ
 *
 * 現状:アカウント削除のみ。将来:データエクスポート、メアド変更等を追加。
 */
export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/app/settings" className="text-muted-foreground text-sm hover:underline">
          ← 設定に戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">アカウント</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          アカウントの削除など、慎重な操作はこちらから。
        </p>
      </div>

      <Card className="space-y-2 p-5">
        <h2 className="text-base font-semibold">登録メールアドレス</h2>
        <p className="text-sm">{user.email}</p>
        <p className="text-muted-foreground text-xs">メールアドレスの変更は現在準備中です。</p>
      </Card>

      <AccountExportSection />

      <AccountDeleteSection />
    </div>
  );
}

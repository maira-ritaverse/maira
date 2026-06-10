import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PasswordForm } from "./password-form";

/**
 * パスワード変更ページ
 *
 * 認証は middleware と layout でガード済みだが、防御的に再チェック。
 * フォーム自体は完全にクライアントサイドで動くため、ここでは
 * リダイレクト判定のみを担当する。
 */
export default async function PasswordSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">パスワード変更</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            ログインに使用するパスワードを変更します
          </p>
        </div>
        <Button render={<Link href="/app/settings" />} variant="outline" size="sm">
          設定に戻る
        </Button>
      </div>

      <PasswordForm />
    </div>
  );
}

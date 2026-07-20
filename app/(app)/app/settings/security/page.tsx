import { redirect } from "next/navigation";

import { MfaPanel } from "@/components/features/security/mfa-panel";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { createClient } from "@/lib/supabase/server";

/**
 * /app/settings/security
 *
 * 求職者 側 の セキュリティ 設定 ページ。 現在 は MFA (二段階認証) のみ。
 * 将来 パスワード 変更 / セッション 一覧 / 削除 履歴 等 を 追加 予定。
 */
export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/settings/security");

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <SettingsBackLink href="/app/settings" />
      <div>
        <h1 className="text-2xl font-bold">セキュリティ</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          アカウントを不正アクセスから守るための設定です。
        </p>
      </div>
      <MfaPanel />
    </div>
  );
}

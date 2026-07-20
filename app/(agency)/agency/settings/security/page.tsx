import { redirect } from "next/navigation";

import { MfaPanel } from "@/components/features/security/mfa-panel";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { createClient } from "@/lib/supabase/server";

/**
 * /agency/settings/security
 *
 * エージェント メンバー 側 の セキュリティ 設定 ページ。 現在 は MFA のみ。
 * agency 側 は 顧客 (求職者) の 個人情報 を 扱う 立場 な の で、 admin ロール
 * だけ でなく advisor も MFA 有効化 を 推奨 (opt-in、 強制 は 次 Phase)。
 */
export const dynamic = "force-dynamic";

export default async function AgencySecuritySettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agency/settings/security");

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <SettingsBackLink href="/agency/settings" />
      <div>
        <h1 className="text-2xl font-bold">セキュリティ</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          アカウントを不正アクセスから守るための設定です。求職者の個人情報を扱う立場のため、二段階認証の有効化を強く推奨します。
        </p>
      </div>
      <MfaPanel />
    </div>
  );
}

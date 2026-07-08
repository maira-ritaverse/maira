import { redirect } from "next/navigation";

import { PasswordForm } from "@/app/(app)/app/settings/password/password-form";
import { PageHeading } from "@/components/ui/page-heading";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * エージェント 個人 設定 - パスワード 変更
 *
 * PasswordForm は /app 側 と 完全 共通 (POST /api/settings/password は user
 * のみ で 更新 する ため account_type 非依存)。
 */
export const dynamic = "force-dynamic";

export default async function AgencyPasswordSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SettingsBackLink href="/agency/settings" />
      <PageHeading
        title="パスワード変更"
        description="ログイン に 使用 する パスワード を 変更 します"
      />

      <PasswordForm />
    </div>
  );
}

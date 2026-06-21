import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/app/(app)/app/settings/profile/profile-form";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-heading";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * エージェント 個人 設定 - プロフィール 編集
 *
 * profiles.display_name は seeker / agency 共通 の カラム の ため、 ProfileForm
 * は /app 側 で 用意 した もの を 直接 流用 (PATCH /api/settings/profile は
 * account_type を 見ず に user.id だけ で 更新 する ため agency でも 動く)。
 *
 * 認可:
 *   ・未 ログイン → /login
 *   ・seeker (organization_member ではない) → /app に 戻す
 */
export const dynamic = "force-dynamic";

export default async function AgencyProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <PageHeading title="プロフィール" description="表示名 などの 基本 情報 を 編集" />
        <Button render={<Link href="/agency/settings" />} variant="outline" size="sm">
          設定 に 戻る
        </Button>
      </div>

      <ProfileForm initialDisplayName={profile?.display_name ?? ""} email={user.email ?? ""} />
    </div>
  );
}

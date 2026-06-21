import Link from "next/link";
import { redirect } from "next/navigation";

import { AvatarUploader } from "@/components/features/profile/avatar-uploader";
import { Button } from "@/components/ui/button";
import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";
import { createClient } from "@/lib/supabase/server";

import { ProfileForm } from "./profile-form";

/**
 * プロフィール編集ページ
 *
 * Server Component で現在の表示名・メールを取得して、
 * Client Component(ProfileForm)に渡す。
 *
 * profile は signup トリガーで自動作成されるが、念のため maybeSingle で扱う。
 */
export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_storage_path")
    .eq("id", user.id)
    .maybeSingle();
  const row = profile as {
    display_name: string | null;
    avatar_storage_path: string | null;
  } | null;
  const avatarPublicUrl = resolveAvatarPublicUrl(supabase, row?.avatar_storage_path ?? null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">プロフィール</h1>
          <p className="text-muted-foreground mt-1 text-sm">表示名 と アイコン 画像 を 編集</p>
        </div>
        <Button render={<Link href="/app/settings" />} variant="outline" size="sm">
          設定 に 戻る
        </Button>
      </div>

      <AvatarUploader
        initialPublicUrl={avatarPublicUrl}
        fallbackInitial={row?.display_name ?? user.email ?? ""}
      />

      <ProfileForm initialDisplayName={row?.display_name ?? ""} email={user.email ?? ""} />
    </div>
  );
}

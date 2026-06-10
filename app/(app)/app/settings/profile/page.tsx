import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
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
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">プロフィール</h1>
          <p className="text-muted-foreground mt-1 text-sm">表示名などの基本情報を編集</p>
        </div>
        <Button render={<Link href="/app/settings" />} variant="outline" size="sm">
          設定に戻る
        </Button>
      </div>

      <ProfileForm initialDisplayName={profile?.display_name ?? ""} email={user.email ?? ""} />
    </div>
  );
}

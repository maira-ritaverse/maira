import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/features/app-sidebar";
import {
  PopupChatLauncher,
  PopupChatProvider,
  PopupChatWindow,
} from "@/components/features/popup-chat";
import { UserMenu } from "@/components/features/user-menu";

/**
 * 認証後のアプリ本体の共通レイアウト
 *
 * middlewareでも未認証ガードはしているが、Server Component側でも
 * userを取得する必要があるため、ここでも明示的にチェックする(防御的)。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // ヘッダー表示用にdisplay_nameを取得(profilesテーブルはサインアップトリガーで自動作成)
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    // ポップアップチャットは認証後の領域全体で利用するため、ここで Provider を張る。
    // Launcher/Window 自体は内部で「現在の応募ID」を見て表示制御するので、
    // 応募詳細ページ以外では何も描画されない。
    <PopupChatProvider>
      <div className="bg-background flex min-h-screen">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-end border-b px-4">
            <UserMenu email={user.email ?? ""} displayName={profile?.display_name ?? null} />
          </header>
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
      <PopupChatLauncher />
      <PopupChatWindow />
    </PopupChatProvider>
  );
}

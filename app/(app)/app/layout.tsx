import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/features/app-sidebar";
import { NotificationBell } from "@/components/features/notifications/notification-bell";
import {
  PopupChatLauncher,
  PopupChatProvider,
  PopupChatWindow,
} from "@/components/features/popup-chat";
import { PrivacyPolicyModal } from "@/components/features/privacy-policy-modal";
import { UserMenu } from "@/components/features/user-menu";
import { countInvitedConnections } from "@/lib/connections/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { getPolicyAcceptance, needsToAccept } from "@/lib/privacy/policy";

/**
 * 認証後のアプリ本体の共通レイアウト
 *
 * middlewareでも未認証ガードはしているが、Server Component側でも
 * userを取得する必要があるため、ここでも明示的にチェックする(防御的)。
 *
 * ロールガード:
 *   /app(求職者領域)は organization_member の侵入を防ぐ。
 *   /agency layout が逆向き(org member 以外 → /app)に追い返しているのと対称。
 *   account_type が organization_member でも membership 実体が無いと
 *   getUserRole は 'seeker' を返す(安全側)。その場合はここを素通りさせる。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // エージェントメンバーは /agency に追い返す。
  // 求職者(seeker)はそのまま通す。
  const role = await getUserRole(user.id);
  if (role.accountType === "organization_member" && role.organization && role.member) {
    redirect("/agency");
  }

  // ヘッダー表示用 display_name と、サイドナビ「エージェント連携」のバッジ用
  // 招待件数を並行取得する。invited 件数は RLS により本人宛て(メール一致)の
  // 行のみ count され、件数 0 のときはサイドナビでバッジを出さない。
  const [{ data: profile }, invitedCount, policyAcceptance] = await Promise.all([
    supabase.from("profiles").select("display_name, archived_at").eq("id", user.id).single(),
    countInvitedConnections(),
    getPolicyAcceptance(user.id),
  ]);

  // 運営者によってアーカイブ(停止)されたユーザはログイン不可。
  // セッションを破棄して /login?archived=1 へ。
  if (profile?.archived_at) {
    await supabase.auth.signOut();
    redirect("/login?archived=1");
  }

  // プライバシーポリシー再同意が必要かを判定。古いバージョン同意済 or 完全新規で文面切替。
  const requirePolicy = needsToAccept(policyAcceptance);
  const hasPriorPolicy = policyAcceptance.acceptedAt !== null;

  return (
    // ポップアップチャットは認証後の領域全体で利用するため、ここで Provider を張る。
    // Launcher/Window 自体は内部で「現在の応募ID」を見て表示制御するので、
    // 応募詳細ページ以外では何も描画されない。
    <PopupChatProvider>
      <div className="bg-background flex min-h-screen">
        <AppSidebar invitedCount={invitedCount} />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-end gap-1 border-b px-4">
            <NotificationBell />
            <UserMenu email={user.email ?? ""} displayName={profile?.display_name ?? null} />
          </header>
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
      <PopupChatLauncher />
      <PopupChatWindow />
      {requirePolicy && <PrivacyPolicyModal hasPrior={hasPriorPolicy} />}
    </PopupChatProvider>
  );
}

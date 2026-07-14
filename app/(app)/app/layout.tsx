import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/features/app-sidebar";
import { MobileNavDrawer } from "@/components/features/mobile-nav-drawer";
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
import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

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
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  // getUserRole + 共通レイアウト 用 4 クエリ を 1 段の Promise.all で 並列化。
  // どれも user.id にしか 依存せず、互いに 独立 して いる ので 待ち合わせ不要。
  // (旧:getUserRole を 直列 await して から 残り 3 並列 → 1 回 余計な round-trip)
  // 後段で role が organization_member だった 場合は redirect で 捨てる が、
  // /app は 求職者 主導線 で 大半 は seeker なので 平均 では 大幅 速化。
  const [role, { data: profile }, invitedCount, policyAcceptance] = await Promise.all([
    getUserRole(user.id),
    supabase
      .from("profiles")
      .select("display_name, archived_at, avatar_storage_path")
      .eq("id", user.id)
      .single(),
    countInvitedConnections(),
    getPolicyAcceptance(user.id),
  ]);

  // エージェントメンバーは /agency に追い返す(求職者は そのまま 通す)
  if (role.accountType === "organization_member" && role.organization && role.member) {
    redirect("/agency");
  }

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
      {/* h-screen overflow-hidden で サイドバー / ヘッダー を 固定、 main 内 のみ スクロール。 */}
      <div className="bg-background flex h-screen overflow-hidden">
        <AppSidebar invitedCount={invitedCount} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center justify-between gap-1 border-b px-4">
            {/* モバイル ナビ トリガー (md 未満)。 desktop 用 sidebar は 左側 に 常設。 */}
            <MobileNavDrawer invitedCount={invitedCount} />
            <div className="flex items-center gap-1">
              <NotificationBell />
              <UserMenu
                email={user.email ?? ""}
                displayName={profile?.display_name ?? null}
                settingsHref="/app/settings"
                avatarUrl={resolveAvatarPublicUrl(
                  supabase,
                  (profile as { avatar_storage_path: string | null } | null)?.avatar_storage_path ??
                    null,
                )}
              />
            </div>
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

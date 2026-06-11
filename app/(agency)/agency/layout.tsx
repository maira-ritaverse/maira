import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { AgencySidebar } from "@/components/features/agency/agency-sidebar";
import { NotificationBell } from "@/components/features/notifications/notification-bell";
import { UserMenu } from "@/components/features/user-menu";

/**
 * エージェント企業メンバー向けの共通レイアウト
 *
 * 求職者向け /app とは完全に分離した別ルートグループ。
 * ロールガード:
 *   - 未ログイン → /login
 *   - account_type が organization_member 以外、または
 *     organization_members レコードが無い場合 → /app に戻す
 *     (「企業メンバーのフリで他テナントのデータが見える」事故を防ぐため、
 *      Phase 1 の getUserRole は member 未存在時に seeker 扱いで返す)
 */
export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // ヘッダー表示用に display_name を取得(求職者向け layout と同じパターン)
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="bg-background flex min-h-screen">
      <AgencySidebar organizationName={role.organization.name} memberRole={role.member.role} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-4">
          <NotificationBell />
          <UserMenu email={user.email ?? ""} displayName={profile?.display_name ?? null} />
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

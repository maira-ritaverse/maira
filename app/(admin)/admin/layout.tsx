import { redirect } from "next/navigation";

import { CommandPalette } from "@/components/features/admin/command-palette";
import { Toaster } from "@/components/features/admin/toaster";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { getAdminDashboardSummary } from "@/lib/admin/dashboard-summary";
import { ToastProvider } from "@/lib/admin/toast/store";
import { createClient } from "@/lib/supabase/server";

import { AdminSidebar } from "./admin-sidebar";

/**
 * /admin/* 専用レイアウト。
 *
 * 認可:
 *   - 未認証 → /login
 *   - 認証済 + is_maira_admin=true 以外 → /
 *
 * レイアウト方針(UX):
 *   - 横ヘッダーから「左サイドナビ + 全幅メイン」に変更(メニュー項目が増えても破綻しない)
 *   - メインは画面いっぱい(max-w 無し)。各ページが自分の最大幅を制御する場合のみ追加。
 *   - 未読件数だけサイドナビに渡し、ホームでは別途サマリ全体を再取得する
 *     (count exact head:true なので二重取得でも軽量)
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = await isMairaAdmin();
  if (!admin) redirect("/");

  // 未読バッジ用に summary を取得(他のサマリ指標はホームで個別表示)
  const summary = await getAdminDashboardSummary();

  return (
    <ToastProvider>
      <div className="bg-background flex min-h-screen">
        <AdminSidebar userEmail={user.email ?? ""} unreadContacts={summary.unreadContacts} />
        <main className="flex-1 overflow-auto">
          <div className="px-6 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
        <CommandPalette />
        <Toaster />
      </div>
    </ToastProvider>
  );
}

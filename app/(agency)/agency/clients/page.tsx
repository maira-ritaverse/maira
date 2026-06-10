import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listClientRecordsWithUpdateBadge } from "@/lib/clients/queries";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/features/agency/export-button";
import { ClientsTable } from "./clients-table";

/**
 * クライアント一覧画面
 *
 * layout.tsx でロールガード済みだが、organization 取り出しのため再度 getUserRole を呼ぶ。
 * listClientRecordsWithAssignee は RLS により自社のクライアントのみ返し、
 * 担当アドバイザー名を SECURITY DEFINER 関数経由で合流させる。
 *
 * 表示はテーブル(行×列)形式。エージェントがスプレッドシートで顧客管理する
 * 慣れに合わせるため、カード表示から切り替えた。
 */
export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  // 新着・更新バッジ用の判定を含めて取得(本人データ最新更新 vs 自分の最終閲覧)。
  // viewerUserId = 自分(認証済みメンバー)。判定対象は linked または期限内 revoke_requested。
  const clients = await listClientRecordsWithUpdateBadge(role.organization.id, user.id);
  const showExport = canExport(role);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">クライアント管理</h1>
          <p className="text-muted-foreground mt-1 text-sm">担当する求職者を管理します</p>
        </div>
        <div className="flex items-center gap-2">
          {showExport && (
            <ExportButton href="/api/agency/export/clients" label="CSV エクスポート" />
          )}
          <Button render={<Link href="/agency/clients/new" />}>+ クライアント登録</Button>
        </div>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon="👥"
          title="クライアントがまだ登録されていません"
          description="「クライアント登録」ボタンから追加できます"
        />
      ) : (
        <ClientsTable clients={clients} />
      )}
    </div>
  );
}

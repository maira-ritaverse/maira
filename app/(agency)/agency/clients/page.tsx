import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import {
  getClientDistributionStats,
  listClientRecordsWithUpdateBadge,
} from "@/lib/clients/queries";
import { listOrganizationMembers } from "@/lib/agency-tasks/queries";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportDialog } from "./export-dialog";
import { ClientsViewTabs } from "./clients-view-tabs";
import { CloseReasonSummary } from "./close-reason-summary";
import { CsvImportDialog } from "./csv-import-dialog";
import { DuplicatesCard } from "./duplicates-card";
import { SilenceAlertCard } from "./silence-alert-card";

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

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // 新着・更新バッジ用の判定を含めて取得(本人データ最新更新 vs 自分の最終閲覧)。
  // viewerUserId = 自分(認証済みメンバー)。判定対象は linked または期限内 revoke_requested。
  // 失注理由・チャネル別の分布サマリも並列で取得(別クエリだが小さい)。
  // members は一括操作(担当者一括変更ドロップダウン)で使う。
  const [clients, distribution, members] = await Promise.all([
    listClientRecordsWithUpdateBadge(role.organization.id, user.id),
    getClientDistributionStats(role.organization.id),
    listOrganizationMembers(role.organization.id),
  ]);
  const showExport = canExport(role);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">クライアント管理</h1>
          <p className="text-muted-foreground mt-1 text-sm">担当するクライアントを管理します</p>
        </div>
        <div className="flex items-center gap-2">
          {showExport && <ExportDialog />}
          <CsvImportDialog />
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
        <>
          {/* 沈黙顧客アラート:対応からの経過日数で分類し、件数バッジで一望させる。
              「対応が止まっている顧客がいる」事実を画面トップで気づかせる。
              バッジクリックで silence パラメータ付きで遷移 → 一覧が自動絞り込み。 */}
          <SilenceAlertCard clients={clients} />
          {/* 重複検出:同一メール / 電話 / 氏名+生年月日 等で重複候補をまとめる。
              admin はその場で「統合する」操作も可能(RPC 経由でトランザクション)。 */}
          <DuplicatesCard clients={clients} canMerge={role.member.role === "admin"} />
          {/* 失注理由・エントリーサイトの分布サマリ。一覧の上に置くことで
              「いまの構成」を一目で確認してから個別レコードに入れるようにする。 */}
          <CloseReasonSummary
            closeReasons={distribution.closeReasons}
            entrySites={distribution.entrySites}
            totalClients={distribution.totalClients}
          />
          <ClientsViewTabs clients={clients} members={members} />
        </>
      )}
    </div>
  );
}

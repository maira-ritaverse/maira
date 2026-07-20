import { Briefcase } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { listJobPostings } from "@/lib/jobs/queries";
import { countLabourFieldsFilled, LABOUR_FIELDS_TOTAL } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/features/agency/export-button";
import { JobsCsvImportDialog } from "./csv-import-dialog";
import { JobsListClient } from "./jobs-list-client";

// 認証 ユーザー の 組織 単位 で 変動 + 画像 等 の 即時 反映 を 担保。
export const dynamic = "force-dynamic";

/**
 * 求人一覧画面
 *
 * layout.tsx でロールガード済みだが、organization 取り出しのため再度 getUserRole を呼ぶ。
 * listJobPostings は RLS により自社の求人のみ返す。
 *
 * 法定明示事項(2024年改正労基法 8 列)が未完了の求人だけを表示するモードを
 * searchParams.incomplete=1 で提供。本番運用前に「入力漏れ求人をまとめて埋める」用途。
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ incomplete?: string }>;
}) {
  const sp = await searchParams;
  const incompleteOnly = sp.incomplete === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const allJobs = await listJobPostings(role.organization.id);
  // 法定未完了モード:8 列の入力数 < 8 の求人だけに絞る。
  // クローズ済み求人は埋める価値が低いので除外しない(運用ルールに任せる)。
  const jobs = incompleteOnly
    ? allJobs.filter((j) => countLabourFieldsFilled(j) < LABOUR_FIELDS_TOTAL)
    : allJobs;
  const incompleteCount = allJobs.filter(
    (j) => countLabourFieldsFilled(j) < LABOUR_FIELDS_TOTAL,
  ).length;
  // プラン tier に よる CSV 使用可否 (Solo は import / export 両方 不可)。
  const plan = await getCurrentOrganizationPlan(supabase);
  const entitlements = getPlanEntitlements(plan?.tier ?? "standard");
  const showExport = canExport(role) && entitlements.canUseCsvExport;
  const showCsvImport = entitlements.canUseCsvImport;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">求人管理</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            クライアントに紹介する求人を管理します
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 法定未完了モードの切替リンク。0 件のときは出さない(押す価値が無い)。
              モード ON のときは「すべて表示」に戻すリンク。 */}
          {incompleteCount > 0 && (
            <Button
              variant={incompleteOnly ? "default" : "outline"}
              size="sm"
              render={<Link href={incompleteOnly ? "/agency/jobs" : "/agency/jobs?incomplete=1"} />}
            >
              {incompleteOnly
                ? `すべて表示(全${allJobs.length}件)`
                : `法定未完了 ${incompleteCount} 件`}
            </Button>
          )}
          {showExport && <ExportButton href="/api/agency/export/jobs" label="CSV エクスポート" />}
          {showCsvImport && <JobsCsvImportDialog />}
          <Button render={<Link href="/agency/jobs/new" />}>+ 求人登録</Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-10" aria-hidden />}
          title="求人がまだ登録されていません"
          description="「求人登録」ボタンから追加できます"
        />
      ) : (
        <JobsListClient jobs={jobs} />
      )}
    </div>
  );
}

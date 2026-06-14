import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { listJobPostings } from "@/lib/jobs/queries";
import {
  jobStatusLabels,
  formatSalaryRange,
  countLabourFieldsFilled,
  LABOUR_FIELDS_TOTAL,
} from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/features/agency/export-button";

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
  const showExport = canExport(role);

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
          <Button render={<Link href="/agency/jobs/new" />}>+ 求人登録</Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          icon="💼"
          title="求人がまだ登録されていません"
          description="「求人登録」ボタンから追加できます"
        />
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <Card key={job.id} className="p-0">
              <Link
                href={`/agency/jobs/${job.id}`}
                className="hover:bg-accent flex items-center justify-between gap-4 p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{job.companyName}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {job.position}
                    {job.location ? ` ・ ${job.location}` : ""}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatSalaryRange(job.salaryMin, job.salaryMax)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* 法定明示事項(2024年改正労基法対応 8 列)の入力進捗。
                      全て埋まったら緑、1 つ以上残ってたら黄、ゼロは赤。 */}
                  <LabourBadge filled={countLabourFieldsFilled(job)} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      job.status === "open"
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : job.status === "paused"
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {jobStatusLabels[job.status]}
                  </span>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 法定明示事項(8 列)の入力進捗バッジ。
 * 0 件 = 赤、1〜7 件 = 黄、8 件全部 = 緑。一覧で「入力漏れ求人」を視覚的に見つけやすくする。
 */
function LabourBadge({ filled }: { filled: number }) {
  const total = LABOUR_FIELDS_TOTAL;
  const colorClass =
    filled === total
      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
      : filled === 0
        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${colorClass}`}
      title="法定明示事項(2024年改正労基法対応 8 項目)の入力進捗"
    >
      法定 {filled}/{total}
    </span>
  );
}

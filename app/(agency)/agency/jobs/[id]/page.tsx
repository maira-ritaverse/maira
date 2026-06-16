import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getJobPosting } from "@/lib/jobs/queries";
import { jobStatusLabels, formatSalaryRange } from "@/lib/jobs/types";
import { listClientRecordsWithAssignee } from "@/lib/clients/queries";
import { Button } from "@/components/ui/button";
import { JobDetailForm } from "./job-detail-form";
import { JobMatchingSection } from "./job-matching-section";

/**
 * 求人詳細画面
 *
 * RLS で自社のレコードしか取れないはずだが、念のため organizationId 一致を
 * 明示確認してから notFound() に倒す(他社の id を踏んだときの 404 担保)。
 */

type RouteParams = { params: Promise<{ id: string }> };

export default async function JobDetailPage({ params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const job = await getJobPosting(id);
  if (!job || job.organizationId !== role.organization.id) {
    notFound();
  }

  // 自社の全クライアント取得(active なものに絞ってマッチング)+ 既応募の clientRecordIds
  const [allClients, { data: referralRows }] = await Promise.all([
    listClientRecordsWithAssignee(role.organization.id),
    supabase
      .from("referrals")
      .select("client_record_id")
      .eq("organization_id", role.organization.id)
      .eq("job_posting_id", id),
  ]);
  const alreadyAppliedClientIds = ((referralRows ?? []) as Array<{ client_record_id: string }>).map(
    (r) => r.client_record_id,
  );
  const activeClients = allClients.filter(
    (c) => c.status !== "completed" && c.status !== "declined",
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{job.companyName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {job.position}
            {job.location ? ` ・ ${job.location}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-2">
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
            <span className="text-muted-foreground text-xs">
              {formatSalaryRange(job.salaryMin, job.salaryMax)}
            </span>
          </div>
        </div>
        <Button render={<Link href="/agency/jobs" />} variant="outline" size="sm">
          一覧に戻る
        </Button>
      </div>

      <JobDetailForm job={job} />

      {/* マッチする顧客候補:既応募は除外。score 15 点未満は出さない。 */}
      <JobMatchingSection
        job={job}
        clients={activeClients}
        alreadyAppliedClientIds={alreadyAppliedClientIds}
      />
    </div>
  );
}

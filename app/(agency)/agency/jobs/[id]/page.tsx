import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { getJobPosting } from "@/lib/jobs/queries";
import { jobStatusLabels, formatSalaryRange } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { JobDetailForm } from "./job-detail-form";

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
    </div>
  );
}

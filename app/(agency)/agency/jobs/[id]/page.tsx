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
import { JobRecommendationsSection } from "./job-recommendations-section";

/**
 * 求人詳細画面
 *
 * RLS で自社のレコードしか取れないはずだが、念のため organizationId 一致を
 * 明示確認してから notFound() に倒す(他社の id を踏んだときの 404 担保)。
 */

type RouteParams = { params: Promise<{ id: string }> };

// 画像 アップロード 後 に 即時 反映 さ せる ため force-dynamic。
export const dynamic = "force-dynamic";

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

  // 自社の全クライアント取得(active なものに絞ってマッチング)+ この求人 の 推薦一覧
  const [allClients, { data: referralRows }] = await Promise.all([
    listClientRecordsWithAssignee(role.organization.id),
    supabase
      .from("referrals")
      .select("id, client_record_id, status, notes, created_at, updated_at")
      .eq("organization_id", role.organization.id)
      .eq("job_posting_id", id)
      .order("created_at", { ascending: false }),
  ]);

  type ReferralRow = {
    id: string;
    client_record_id: string;
    status: "planned" | "recommended" | "screening" | "interview" | "offer" | "joined" | "declined";
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  const referrals = (referralRows ?? []) as ReferralRow[];
  const alreadyAppliedClientIds = referrals.map((r) => r.client_record_id);
  const activeClients = allClients.filter(
    (c) => c.status !== "completed" && c.status !== "declined",
  );

  // 推薦中 行 を クライアント情報 + LINE 紐付け で 拡張
  const clientById = new Map(allClients.map((c) => [c.id, c]));
  const recommendedClientIds = referrals.map((r) => r.client_record_id);
  const { data: lineLinks } =
    recommendedClientIds.length > 0
      ? await supabase
          .from("line_user_links")
          .select("client_record_id, line_user_id")
          .in("client_record_id", recommendedClientIds)
          .is("unfollowed_at", null)
      : { data: [] };
  const lineByClient = new Map(
    ((lineLinks ?? []) as Array<{ client_record_id: string; line_user_id: string }>).map((l) => [
      l.client_record_id,
      l.line_user_id,
    ]),
  );

  const referralViews = referrals.map((r) => {
    const c = clientById.get(r.client_record_id);
    return {
      referralId: r.id,
      clientRecordId: r.client_record_id,
      clientName: c?.name ?? "(不明)",
      assigneeName: c?.assigneeName ?? null,
      status: r.status,
      notes: r.notes,
      lineUserId: lineByClient.get(r.client_record_id) ?? null,
      createdAt: r.created_at,
    };
  });

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
        <div className="flex gap-2">
          <Button
            render={<a href={`/api/agency/jobs/${job.id}/pdf`} download />}
            variant="outline"
            size="sm"
          >
            求人票 PDF
          </Button>
          <Button render={<Link href="/agency/jobs" />} variant="outline" size="sm">
            一覧に戻る
          </Button>
        </div>
      </div>

      <JobDetailForm
        job={job}
        heroImageUrl={
          job.heroImagePath
            ? supabase.storage.from("job-images").getPublicUrl(job.heroImagePath).data.publicUrl
            : null
        }
        lineShareImageUrl={
          job.lineShareImagePath
            ? supabase.storage.from("job-images").getPublicUrl(job.lineShareImagePath).data
                .publicUrl
            : null
        }
      />

      {/* この 求人 を 推薦中 の クライアント 一覧 (LINE 紐付け 済 なら LINE 共有 可) */}
      <JobRecommendationsSection job={job} referrals={referralViews} />

      {/* マッチする顧客候補:既推薦は除外。score 15 点未満は出さない。 */}
      <JobMatchingSection
        job={job}
        clients={activeClients}
        alreadyAppliedClientIds={alreadyAppliedClientIds}
      />
    </div>
  );
}

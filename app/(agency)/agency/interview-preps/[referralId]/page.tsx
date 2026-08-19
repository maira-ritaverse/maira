import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getClientRecord } from "@/lib/clients/queries";
import { getInterviewPrepByReferral } from "@/lib/interview-preps/queries";
import { getJobPosting } from "@/lib/jobs/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { getReferral } from "@/lib/referrals/queries";
import { createClient } from "@/lib/supabase/server";

import { InterviewPrepPanel } from "./interview-prep-panel";

/**
 * 面接対策ページ
 *
 * URL: /agency/interview-preps/[referralId]
 *
 * referral(候補者 × 求人)単位。左に求人票、右に AI 生成の面接対策を 2 カラムで表示。
 * RLS で自社の referral しか取れないが、getReferral が null / 別組織なら notFound。
 */
type RouteParams = { params: Promise<{ referralId: string }> };

/** 年収レンジを「400〜600 万円」形式に整形(片側のみ / 未設定にも対応)。 */
function formatSalary(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return `${min}〜${max} 万円`;
  if (min != null) return `${min} 万円〜`;
  if (max != null) return `〜${max} 万円`;
  return null;
}

export default async function InterviewPrepPage({ params }: RouteParams) {
  const { referralId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const referral = await getReferral(referralId);
  if (!referral || referral.organizationId !== role.organization.id) notFound();

  const [client, job, prep] = await Promise.all([
    getClientRecord(referral.clientRecordId),
    getJobPosting(referral.jobPostingId),
    getInterviewPrepByReferral(referralId, role.organization.id),
  ]);
  if (!client || !job) notFound();

  const salary = formatSalary(job.salaryMin, job.salaryMax);

  // 求人票の表示項目(空はスキップ)
  const jobFields: { label: string; value: string | null }[] = [
    { label: "雇用形態", value: job.employmentType },
    { label: "勤務地", value: job.location },
    { label: "想定年収", value: salary },
    { label: "仕事内容", value: job.description },
    { label: "必須条件", value: job.requiredSkills },
    { label: "歓迎条件", value: job.preferredSkills },
    { label: "応募資格", value: job.applicationQualifications },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-6 lg:px-6">
      <div className="mb-4">
        <Link
          href={`/agency/clients/${client.id}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← {client.name}さんのページに戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold">面接対策</h1>
        <p className="text-muted-foreground text-sm">
          {client.name}さん × {job.companyName}({job.position})
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 左:求人票 */}
        <Card className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold">{job.companyName}</h2>
              <p className="text-muted-foreground text-sm">{job.position}</p>
            </div>
            <Link
              href={`/agency/jobs/${job.id}`}
              className="text-primary shrink-0 text-xs hover:underline"
            >
              求人票を開く
            </Link>
          </div>
          <dl className="space-y-3 text-sm">
            {jobFields
              .filter((f) => f.value && f.value.trim().length > 0)
              .map((f) => (
                <div key={f.label}>
                  <dt className="text-muted-foreground text-xs font-medium">{f.label}</dt>
                  <dd className="whitespace-pre-wrap">{f.value}</dd>
                </div>
              ))}
          </dl>
        </Card>

        {/* 右:面接対策 */}
        <InterviewPrepPanel
          referralId={referralId}
          clientName={client.name}
          initialContent={prep?.content ?? null}
          initialGeneratedAt={prep?.generatedAt ?? null}
        />
      </div>
    </div>
  );
}

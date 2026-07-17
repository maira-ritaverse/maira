import { notFound } from "next/navigation";

import { createServiceClient } from "@/lib/supabase/service";

import { LiffJobView } from "./liff-job-view";

/**
 * /liff/[orgId]/jobs/[jobId]
 *
 * LIFF 求人 詳細 ページ (LINE アプリ 内 ブラウザ で 開く)。
 *
 * フロー:
 *   1. URL は LINE が `https://liff.line.me/{liffId}/jobs/{jobId}` を redirect で 着地
 *      (Endpoint URL = https://app.maira.pro/liff/{orgId})
 *   2. クライアント側 で LIFF SDK init → ID Token 取得 → 求職者 認証
 *   3. 求人詳細 を 表示 → 「応募 する」ボタン → /liff/[orgId]/apply/[jobId] へ
 *
 * セキュリティ:
 *   ・job_postings は org 内 RLS だが、 LIFF は anon クライアント が 直接 触れる
 *     ようには 出来ない (org_id が URL に ある = ある程度 公開情報 として 設計)
 *   ・service_role で 「organization_id 一致 + status='open'」だけ 返す
 *   ・応募作成 は POST 時 に サーバ側で 再認証 + 検証
 */
type RouteContext = { params: Promise<{ orgId: string; jobId: string }> };

export default async function LiffJobDetailPage({ params }: RouteContext) {
  const { orgId, jobId } = await params;

  const admin = createServiceClient();

  // 組織 + LIFF 設定 を 取得
  const { data: channelRow } = await admin
    .from("line_channels")
    .select("organization_id, liff_id, line_channel_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  const channel = channelRow as {
    organization_id: string;
    liff_id: string | null;
    line_channel_id: string;
  } | null;
  if (!channel || !channel.liff_id) {
    notFound();
  }

  // 求人 を 取得 (公開可能 な open のみ)
  const { data: jobRow } = await admin
    .from("job_postings")
    .select(
      "id, organization_id, company_name, position, employment_type, location, salary_min, salary_max, work_style, required_skills, preferred_skills, description, holidays, status",
    )
    .eq("id", jobId)
    .eq("organization_id", orgId)
    .maybeSingle();
  type JobRow = {
    id: string;
    organization_id: string;
    company_name: string;
    position: string;
    employment_type: string | null;
    location: string | null;
    salary_min: number | null;
    salary_max: number | null;
    work_style: string | null;
    required_skills: string[] | null;
    preferred_skills: string[] | null;
    description: string | null;
    holidays: string | null;
    status: string;
  };
  const job = jobRow as JobRow | null;
  if (!job || job.status !== "open") {
    notFound();
  }

  // 組織名
  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const organizationName = (orgRow as { name?: string } | null)?.name ?? "(エージェント)";

  return (
    <LiffJobView
      liffId={channel.liff_id}
      orgId={orgId}
      organizationName={organizationName}
      job={{
        id: job.id,
        position: job.position,
        companyName: job.company_name,
        employmentType: job.employment_type,
        location: job.location,
        salaryMin: job.salary_min,
        salaryMax: job.salary_max,
        workStyle: job.work_style,
        requiredSkills: job.required_skills ?? [],
        preferredSkills: job.preferred_skills ?? [],
        description: job.description,
        holidays: job.holidays,
      }}
    />
  );
}

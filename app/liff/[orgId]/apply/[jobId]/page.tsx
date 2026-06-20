import { notFound } from "next/navigation";

import { createServiceClient } from "@/lib/supabase/service";

import { LiffApplyForm } from "./liff-apply-form";

/**
 * /liff/[orgId]/apply/[jobId]
 *
 * LIFF 応募 フォーム ページ。
 *
 * フロー:
 *   1. LIFF SDK init → 未ログイン なら liff.login()
 *   2. プロフィール (userId / displayName) + ID Token 取得
 *   3. 「応募 する」 → /api/liff/applications POST
 *      (サーバ で ID Token 検証 + line_messages に 「応募希望」 記録 + 通知 fan-out)
 */
type RouteContext = { params: Promise<{ orgId: string; jobId: string }> };

export default async function LiffApplyPage({ params }: RouteContext) {
  const { orgId, jobId } = await params;

  const admin = createServiceClient();
  const { data: channelRow } = await admin
    .from("line_channels")
    .select("liff_id, line_channel_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  const channel = channelRow as { liff_id: string | null; line_channel_id: string } | null;
  if (!channel || !channel.liff_id) notFound();

  const { data: jobRow } = await admin
    .from("job_postings")
    .select("id, company_name, position, status")
    .eq("id", jobId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const job = jobRow as {
    id: string;
    company_name: string;
    position: string;
    status: string;
  } | null;
  if (!job || job.status !== "open") notFound();

  return (
    <LiffApplyForm
      liffId={channel.liff_id}
      lineChannelId={channel.line_channel_id}
      orgId={orgId}
      jobId={jobId}
      jobLabel={`${job.position} (${job.company_name})`}
    />
  );
}

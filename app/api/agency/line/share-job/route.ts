import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import type { LineMessage } from "@/lib/line/api";
import { buildJobShareCard, buildJobShareCarousel } from "@/lib/line/flex";
import { markConversationHandled, sendMessages } from "@/lib/line/messaging";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/share-job
 *
 * 求人 を LINE に Flex Message で 送信。
 * 1 件 → bubble、 複数 → carousel (最大 12 件)。
 *
 * URL は LIFF が 設定 されて いれば LIFF URL、 無ければ
 * `https://maira.pro/app/jobs/{id}` (求職者側 詳細ページ)。
 *
 * 送信後 line_messages.related_job_id を 単発紐付け で 更新 (1 件 目 のみ)。
 */
const bodySchema = z.object({
  lineUserId: z.string().min(1).max(64),
  jobIds: z.array(z.string().uuid()).min(1).max(12),
  /** 「興味あり」postback ボタン を 付ける か (デフォルト true) */
  withInterestButton: z.boolean().optional(),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { lineUserId, jobIds, withInterestButton = true } = parsed.data;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // 自組織 の line_user_id か 確認
  const { data: linkRow } = await admin
    .from("line_user_links")
    .select("line_user_id, unfollowed_at")
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const link = linkRow as { line_user_id: string; unfollowed_at: string | null } | null;
  if (!link) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }
  if (link.unfollowed_at) {
    return NextResponse.json({ error: "line_user_unfollowed" }, { status: 409 });
  }

  // 求人 を 一括取得 (自組織のもの だけ、 RLS 経由)
  const { data: jobsData } = await guard.supabase
    .from("job_postings")
    .select("id, company_name, position, location, salary_min, salary_max")
    .in("id", jobIds);

  type JobRow = {
    id: string;
    company_name: string;
    position: string;
    location: string | null;
    salary_min: number | null;
    salary_max: number | null;
  };
  const jobs = (jobsData ?? []) as JobRow[];
  if (jobs.length === 0) {
    return NextResponse.json({ error: "no_jobs_found" }, { status: 404 });
  }

  // jobIds の 順序 を 維持
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const orderedJobs = jobIds.map((id) => jobMap.get(id)).filter((j): j is JobRow => !!j);

  const cards = orderedJobs.map((job) => {
    const detailUrl = channel.liffId
      ? `https://liff.line.me/${channel.liffId}/jobs/${job.id}`
      : buildAbsoluteUrl(`/app/jobs/${job.id}`);
    return {
      jobId: job.id,
      position: job.position,
      companyName: job.company_name,
      location: job.location,
      salaryText: formatSalary(job.salary_min, job.salary_max),
      heroImageUrl: null,
      detailUrl,
      interestPostbackData: withInterestButton ? `job_interest:${job.id}` : undefined,
    };
  });

  const flexMessage: LineMessage =
    cards.length === 1 ? buildJobShareCard(cards[0]) : buildJobShareCarousel(cards);

  const sendResult = await sendMessages(
    admin,
    guard.organization.id,
    lineUserId,
    channel.channelAccessToken,
    [flexMessage],
  );

  if (!sendResult.ok) {
    return NextResponse.json({ error: "send_failed", message: sendResult.reason }, { status: 502 });
  }

  // line_messages.related_job_id を セット (1 件目 を 代表)
  if (orderedJobs.length > 0 && sendResult.messageId) {
    await admin
      .from("line_messages")
      .update({ related_job_id: orderedJobs[0].id })
      .eq("id", sendResult.messageId);
  }

  // 対応済 マーク
  await markConversationHandled(admin, guard.organization.id, lineUserId, guard.user.id);

  return NextResponse.json({
    ok: true,
    messageId: sendResult.messageId,
    sendMethod: sendResult.sendMethod,
    jobCount: orderedJobs.length,
  });
}

function formatSalary(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const fmt = (v: number) => `${Math.round(v / 10000)} 万円`;
  if (min !== null && max !== null) return `${fmt(min)} 〜 ${fmt(max)}`;
  if (min !== null) return `${fmt(min)} 〜`;
  if (max !== null) return `〜 ${fmt(max)}`;
  return null;
}

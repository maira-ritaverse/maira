import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { formatSalaryRange } from "@/lib/jobs/types";
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
// 後方互換 で 単数 lineUserId / 新形式 lineUserIds どちら も 受ける。
const bodySchema = z.object({
  lineUserId: z.string().min(1).max(64).optional(),
  lineUserIds: z.array(z.string().min(1).max(64)).min(1).max(500).optional(),
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
  const { lineUserId, lineUserIds, jobIds, withInterestButton = true } = parsed.data;
  const recipients: string[] = lineUserIds ?? (lineUserId ? [lineUserId] : []);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "no_recipients", message: "lineUserId か lineUserIds を 指定 して ください" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // 自組織 の 友達 かつ unfollow されて いない 行 のみ 抽出
  const { data: linkRows } = await admin
    .from("line_user_links")
    .select("line_user_id, unfollowed_at")
    .eq("organization_id", guard.organization.id)
    .in("line_user_id", recipients);
  const allowed = new Set(
    ((linkRows ?? []) as Array<{ line_user_id: string; unfollowed_at: string | null }>)
      .filter((r) => r.unfollowed_at === null)
      .map((r) => r.line_user_id),
  );
  const validRecipients = recipients.filter((id) => allowed.has(id));
  if (validRecipients.length === 0) {
    return NextResponse.json({ error: "line_user_not_found_or_unfollowed" }, { status: 404 });
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
    // salary は 万円 単位 で 保存 されて いる ので 既存 ヘルパー を そのまま 使う。
    // 両方 null の 場合 だけ 「応相談」を 出さず Flex から 行 を 省く 方が UI 上 良い。
    const salaryText =
      job.salary_min === null && job.salary_max === null
        ? null
        : formatSalaryRange(job.salary_min, job.salary_max);
    return {
      jobId: job.id,
      position: job.position,
      companyName: job.company_name,
      location: job.location,
      salaryText,
      heroImageUrl: null,
      detailUrl,
      interestPostbackData: withInterestButton ? `job_interest:${job.id}` : undefined,
    };
  });

  const flexMessage: LineMessage =
    cards.length === 1 ? buildJobShareCard(cards[0]) : buildJobShareCarousel(cards);

  // 全 受信者 に 並列 送信 (LINE API レート は ループ 1 つ ずつ 順次 が 安全)。
  // 並列 5 で 適度 に スループット を 出し つつ レート 制限 を 越え ない。
  const concurrency = 5;
  const results: Array<{
    lineUserId: string;
    ok: boolean;
    sendMethod?: "reply" | "push";
    messageId?: string;
    error?: string;
  }> = [];
  for (let i = 0; i < validRecipients.length; i += concurrency) {
    const slice = validRecipients.slice(i, i + concurrency);
    const sliceResults = await Promise.all(
      slice.map(async (lineUserId) => {
        const sendResult = await sendMessages(
          admin,
          guard.organization.id,
          lineUserId,
          channel.channelAccessToken,
          [flexMessage],
        );
        if (!sendResult.ok) {
          return { lineUserId, ok: false, error: sendResult.reason };
        }
        if (orderedJobs.length > 0 && sendResult.messageId) {
          await admin
            .from("line_messages")
            .update({ related_job_id: orderedJobs[0].id })
            .eq("id", sendResult.messageId);
        }
        await markConversationHandled(admin, guard.organization.id, lineUserId, guard.user.id);
        return {
          lineUserId,
          ok: true,
          sendMethod: sendResult.sendMethod,
          messageId: sendResult.messageId,
        };
      }),
    );
    results.push(...sliceResults);
  }

  const sentCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - sentCount;

  return NextResponse.json({
    ok: true,
    requested: recipients.length,
    sent: sentCount,
    failed: failedCount,
    jobCount: orderedJobs.length,
    // 後方互換: 単発 ケース の messageId / sendMethod
    messageId: results[0]?.messageId,
    sendMethod: results[0]?.sendMethod,
    results,
  });
}

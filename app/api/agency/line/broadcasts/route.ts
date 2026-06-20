import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { encryptField } from "@/lib/crypto/field-encryption";
import { getJobShareImageUrl } from "@/lib/jobs/image-url";
import { formatSalaryRange } from "@/lib/jobs/types";
import { multicastMessage, type LineMessage } from "@/lib/line/api";
import { classifyLineError } from "@/lib/line/errors";
import { buildJobShareCard, buildJobShareCarousel } from "@/lib/line/flex";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/broadcasts
 *   配信履歴 (新しい順、 max 50 件)
 *
 * POST /api/agency/line/broadcasts
 *   一斉配信 を 開始 / 予約。
 *
 * 入力 (kind 排他):
 *   { kind: "text", text, target, scheduledFor? }
 *   { kind: "job",  jobIds: [...up to 12], target, scheduledFor? }
 *
 * 即時 配信 = scheduledFor 省略
 * 予約 配信 = scheduledFor ISO 文字列。 status='queued' で 保存。
 *              cron /api/internal/line/broadcasts-dispatch で 拾われ 実行。
 *
 * エラー分類:
 *   各 multicast 失敗 で classifyLineError() を 呼び DB に
 *   error_message = "<kind>: <human message>" で 記録。
 */
const SLICE_SIZE = 500;

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("line_broadcasts")
    .select(
      "id, created_by_user_id, message_type, target_filter, target_count, status, sent_count, failed_count, scheduled_for, sent_at, error_message, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  type BroadcastRow = {
    id: string;
    created_by_user_id: string;
    message_type: string;
    target_filter: { kind: "all" | "linked" | "unlinked"; jobIds?: string[] };
    target_count: number;
    status: "queued" | "sending" | "sent" | "failed";
    sent_count: number;
    failed_count: number;
    scheduled_for: string | null;
    sent_at: string | null;
    error_message: string | null;
    created_at: string;
  };

  const rows = (data ?? []) as BroadcastRow[];
  return NextResponse.json({
    broadcasts: rows.map((b) => ({
      id: b.id,
      createdByUserId: b.created_by_user_id,
      messageType: b.message_type,
      targetKind: b.target_filter.kind,
      jobIds: b.target_filter.jobIds ?? null,
      targetCount: b.target_count,
      status: b.status,
      sentCount: b.sent_count,
      failedCount: b.failed_count,
      scheduledFor: b.scheduled_for,
      sentAt: b.sent_at,
      errorMessage: b.error_message,
      createdAt: b.created_at,
    })),
  });
}

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(5000),
    target: z.enum(["all", "linked", "unlinked"]),
    scheduledFor: z.string().datetime().optional(),
  }),
  z.object({
    kind: z.literal("job"),
    jobIds: z.array(z.string().uuid()).min(1).max(12),
    target: z.enum(["all", "linked", "unlinked"]),
    scheduledFor: z.string().datetime().optional(),
  }),
]);

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

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // ターゲット 取得 (unfollowed 除外)
  let query = admin
    .from("line_user_links")
    .select("line_user_id, client_record_id")
    .eq("organization_id", guard.organization.id)
    .is("unfollowed_at", null);
  if (parsed.data.target === "linked") {
    query = query.not("client_record_id", "is", null);
  } else if (parsed.data.target === "unlinked") {
    query = query.is("client_record_id", null);
  }
  const { data: userRows } = await query;
  type LinkRow = { line_user_id: string };
  const userIds = ((userRows ?? []) as LinkRow[]).map((r) => r.line_user_id);

  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "no_recipients", message: "対象 ユーザー が いません" },
      { status: 400 },
    );
  }

  // メッセージ 構築 (text / job)
  let message: LineMessage;
  let encryptedContent: string;
  let messageType: "text" | "flex";
  let jobIdsForFilter: string[] | undefined;

  if (parsed.data.kind === "text") {
    const text = parsed.data.text;
    const enc = await encryptField(text);
    if (!enc) {
      return NextResponse.json({ error: "encrypt_failed" }, { status: 500 });
    }
    encryptedContent = enc;
    message = { type: "text", text };
    messageType = "text";
  } else {
    const { data: jobsData } = await admin
      .from("job_postings")
      .select(
        "id, company_name, position, location, salary_min, salary_max, hero_image_path, line_share_image_path",
      )
      .in("id", parsed.data.jobIds)
      .eq("organization_id", guard.organization.id);
    type JobRow = {
      id: string;
      company_name: string;
      position: string;
      location: string | null;
      salary_min: number | null;
      salary_max: number | null;
      hero_image_path: string | null;
      line_share_image_path: string | null;
    };
    const jobs = (jobsData ?? []) as JobRow[];
    if (jobs.length === 0) {
      return NextResponse.json({ error: "no_jobs_found" }, { status: 404 });
    }
    const jobMap = new Map(jobs.map((j) => [j.id, j]));
    const orderedJobs = parsed.data.jobIds
      .map((id) => jobMap.get(id))
      .filter((j): j is JobRow => !!j);
    const cards = orderedJobs.map((job) => ({
      jobId: job.id,
      position: job.position,
      companyName: job.company_name,
      location: job.location,
      salaryText:
        job.salary_min === null && job.salary_max === null
          ? null
          : formatSalaryRange(job.salary_min, job.salary_max),
      heroImageUrl: getJobShareImageUrl(admin, job),
      detailUrl: channel.liffId
        ? `https://liff.line.me/${channel.liffId}/jobs/${job.id}`
        : buildAbsoluteUrl(`/app/jobs/${job.id}`),
      interestPostbackData: `job_interest:${job.id}`,
    }));
    message = cards.length === 1 ? buildJobShareCard(cards[0]) : buildJobShareCarousel(cards);
    // 履歴 用 に Flex JSON を 暗号化 保存
    const enc = await encryptField(JSON.stringify({ kind: "job", jobIds: parsed.data.jobIds }));
    if (!enc) {
      return NextResponse.json({ error: "encrypt_failed" }, { status: 500 });
    }
    encryptedContent = enc;
    messageType = "flex";
    jobIdsForFilter = parsed.data.jobIds;
  }

  const scheduledFor = parsed.data.scheduledFor ?? null;
  const isScheduled = scheduledFor !== null && new Date(scheduledFor).getTime() > Date.now();

  // 配信履歴 行 を INSERT
  const { data: bcRow, error: bcErr } = await admin
    .from("line_broadcasts")
    .insert({
      organization_id: guard.organization.id,
      created_by_user_id: guard.user.id,
      encrypted_content: encryptedContent,
      message_type: messageType,
      target_filter: {
        kind: parsed.data.target,
        ...(jobIdsForFilter ? { jobIds: jobIdsForFilter } : {}),
      },
      target_count: userIds.length,
      status: isScheduled ? "queued" : "sending",
      scheduled_for: scheduledFor,
    })
    .select("id")
    .single();
  if (bcErr || !bcRow) {
    return NextResponse.json(
      { error: "db_insert_failed", message: bcErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const broadcastId = (bcRow as { id: string }).id;

  // 予約 の 場合 は ここで 返却。 cron が 後で 拾って 実行。
  if (isScheduled) {
    return NextResponse.json({
      ok: true,
      broadcastId,
      scheduled: true,
      scheduledFor,
      estimatedCharge: userIds.length,
    });
  }

  // 即時 配信
  let sentCount = 0;
  let failedCount = 0;
  let lastErrorMessage: string | null = null;

  for (let i = 0; i < userIds.length; i += SLICE_SIZE) {
    const slice = userIds.slice(i, i + SLICE_SIZE);
    const result = await multicastMessage(channel.channelAccessToken, slice, [message]);
    if (result.ok) {
      sentCount += slice.length;
    } else {
      failedCount += slice.length;
      const cls = classifyLineError(result.status, result.message);
      lastErrorMessage = `${cls.kind}: ${cls.message}`;
      // quota_exceeded は 残りスライス も 確実 失敗 する ので 早期 break
      if (cls.kind === "quota_exceeded" || cls.kind === "unauthorized") {
        // 残り 全部 失敗 として 加算
        for (let j = i + SLICE_SIZE; j < userIds.length; j += SLICE_SIZE) {
          const remaining = userIds.slice(j, j + SLICE_SIZE);
          failedCount += remaining.length;
        }
        break;
      }
    }
  }

  const finalStatus = failedCount === 0 ? "sent" : sentCount > 0 ? "sent" : "failed";
  await admin
    .from("line_broadcasts")
    .update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
      error_message: lastErrorMessage,
    })
    .eq("id", broadcastId);

  return NextResponse.json({
    ok: true,
    broadcastId,
    sentCount,
    failedCount,
    estimatedCharge: sentCount,
    errorMessage: lastErrorMessage,
  });
}

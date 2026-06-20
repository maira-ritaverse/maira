import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { decryptField } from "@/lib/crypto/field-encryption";
import { getJobShareImageUrl } from "@/lib/jobs/image-url";
import { formatSalaryRange } from "@/lib/jobs/types";
import { multicastMessage, type LineMessage } from "@/lib/line/api";
import { resolveBroadcastTargetLineUserIds } from "@/lib/line/broadcast-targets";
import { classifyLineError } from "@/lib/line/errors";
import { buildJobShareCard, buildJobShareCarousel } from "@/lib/line/flex";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST/GET /api/internal/line/broadcasts-dispatch
 *
 * 予約配信 (status='queued' かつ scheduled_for ≤ now()) を 拾って 実行 する cron。
 * 1 tick で 5 件 まで 同時 処理 (LINE quota 暴走 を 防ぐ ため 控えめ)。
 *
 * Vercel Cron で 1 分 ごと 起動 想定。
 */
const SLICE_SIZE = 500;
const MAX_PER_TICK = 5;

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json(
        { error: "CRON_SECRET / INTAKE_CRON_SECRET 未設定" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  // queued + 時間 到達 を 拾う
  const { data: dueRows } = await admin
    .from("line_broadcasts")
    .select("id, organization_id, encrypted_content, message_type, target_filter, target_count")
    .eq("status", "queued")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_PER_TICK);

  type Row = {
    id: string;
    organization_id: string;
    encrypted_content: string;
    message_type: "text" | "flex";
    target_filter: {
      kind: "all" | "linked" | "unlinked";
      tags?: string[];
      jobIds?: string[];
    };
    target_count: number;
  };
  const broadcasts = (dueRows ?? []) as Row[];

  const processed: Array<{
    id: string;
    status: string;
    sentCount: number;
    failedCount: number;
    error?: string;
  }> = [];

  for (const bc of broadcasts) {
    // status='sending' に 進める (二重 起動 防止)
    const { error: lockErr } = await admin
      .from("line_broadcasts")
      .update({ status: "sending" })
      .eq("id", bc.id)
      .eq("status", "queued");
    if (lockErr) continue;

    const channel = await getLineChannelByOrgId(admin, bc.organization_id);
    if (!channel) {
      await admin
        .from("line_broadcasts")
        .update({
          status: "failed",
          error_message: "channel_not_configured",
          sent_at: new Date().toISOString(),
        })
        .eq("id", bc.id);
      processed.push({ id: bc.id, status: "failed", sentCount: 0, failedCount: bc.target_count });
      continue;
    }

    // ターゲット 再取得 (予約時 と 現時点 で 友達 数 / タグ が 変わって いる 可能性 あり)
    const userIds = await resolveBroadcastTargetLineUserIds(admin, {
      organizationId: bc.organization_id,
      target: bc.target_filter.kind,
      tags: bc.target_filter.tags ?? null,
    });

    // メッセージ 復元
    let message: LineMessage;
    if (bc.message_type === "text") {
      const text = (await decryptField(bc.encrypted_content)) ?? "";
      message = { type: "text", text };
    } else {
      // job flex: filter.jobIds から 再構築
      const jobIds = bc.target_filter.jobIds ?? [];
      const { data: jobsData } = await admin
        .from("job_postings")
        .select(
          "id, company_name, position, location, salary_min, salary_max, hero_image_path, line_share_image_path",
        )
        .in("id", jobIds)
        .eq("organization_id", bc.organization_id);
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
      const jobMap = new Map(jobs.map((j) => [j.id, j]));
      const orderedJobs = jobIds.map((id) => jobMap.get(id)).filter((j): j is JobRow => !!j);
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
      if (cards.length === 0) {
        await admin
          .from("line_broadcasts")
          .update({
            status: "failed",
            error_message: "all_jobs_deleted",
            sent_at: new Date().toISOString(),
          })
          .eq("id", bc.id);
        processed.push({
          id: bc.id,
          status: "failed",
          sentCount: 0,
          failedCount: userIds.length,
        });
        continue;
      }
      message = cards.length === 1 ? buildJobShareCard(cards[0]) : buildJobShareCarousel(cards);
    }

    // multicast
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
        if (cls.kind === "quota_exceeded" || cls.kind === "unauthorized") {
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
      .eq("id", bc.id);

    processed.push({
      id: bc.id,
      status: finalStatus,
      sentCount,
      failedCount,
      error: lastErrorMessage ?? undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    processed: processed.length,
    results: processed,
  });
}

export const GET = POST;

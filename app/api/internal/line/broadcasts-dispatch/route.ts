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
 * 予約 配信 (status='queued' かつ scheduled_for / next_retry_at ≤ now()) を
 * 拾って 実行 する cron。 Vercel Cron で 1 分 ごと 起動 想定。
 *
 * C2-2 修正 (2026-07-08):
 *   ・単純 な MAX_PER_TICK=5 制限 だけ だと 予約 数 1,000 件 で 200 分 以上 かかる。
 *     加え て、 1 件 の 中 で LINE API が 一時 障害 を 返した 場合 に 即 failed
 *     と なり 再試行 手段 が 無かった。
 *   ・adaptive batching + wall-clock 制限 で 「function 時間 予算 が 尽きる
 *     直前 に 抜ける」 方針 に。
 *   ・一時 障害 (network / http_5xx) は status を queued に 戻し、 指数 バック
 *     オフ (retry_count 依存) で 次回 tick に 拾い 直す。 上限 到達 で failed。
 *
 * 数値 の 意図:
 *   - TICK_TIME_BUDGET_MS = 45s: Vercel Pro の 60s function 上限 に 対して
 *     safe margin を 取る (LINE API の 平均 応答 500ms、 15 件 で 7.5s 想定)
 *   - HARD_MAX_PER_TICK = 30: 極端 な 数 の 小 配信 が 積まれて い た 場合 の 天井
 *   - MAX_RETRIES = 3: 一時 障害 が 3 回 連続 したら 手動 判断 に 委ねる
 *   - RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] = 1 / 5 / 15 分
 */
const SLICE_SIZE = 500;
const HARD_MAX_PER_TICK = 30;
const TICK_TIME_BUDGET_MS = 45_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000] as const;

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
  const tickStartedAt = Date.now();
  const nowIso = new Date().toISOString();

  // queued + (scheduled_for か next_retry_at) の どちら か が now() 以前 を 拾う。
  // Supabase の filter は 単純 OR が 書き にくい ので、 まず next_retry_at IS NULL
  // 系 (scheduled_for 到達 の 通常 の 予約) を 拾い、 足り なく なったら 別 クエリ で
  // リトライ 待ち を 補う。 HARD_MAX_PER_TICK が 天井。
  const { data: primaryRows } = await admin
    .from("line_broadcasts")
    .select(
      "id, organization_id, encrypted_content, message_type, target_filter, target_count, retry_count, scheduled_for, next_retry_at",
    )
    .eq("status", "queued")
    .is("next_retry_at", null)
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(HARD_MAX_PER_TICK);

  let dueRows = primaryRows ?? [];
  if (dueRows.length < HARD_MAX_PER_TICK) {
    const remaining = HARD_MAX_PER_TICK - dueRows.length;
    const { data: retryRows } = await admin
      .from("line_broadcasts")
      .select(
        "id, organization_id, encrypted_content, message_type, target_filter, target_count, retry_count, scheduled_for, next_retry_at",
      )
      .eq("status", "queued")
      .not("next_retry_at", "is", null)
      .lte("next_retry_at", nowIso)
      .order("next_retry_at", { ascending: true })
      .limit(remaining);
    dueRows = [...dueRows, ...(retryRows ?? [])];
  }

  type Row = {
    id: string;
    organization_id: string;
    encrypted_content: string;
    message_type: "text" | "flex";
    target_filter: {
      kind: "all" | "linked" | "unlinked";
      tagIds?: string[];
      jobIds?: string[];
    };
    target_count: number;
    retry_count: number;
    scheduled_for: string | null;
    next_retry_at: string | null;
  };
  const broadcasts = (dueRows ?? []) as Row[];

  const processed: Array<{
    id: string;
    status: string;
    sentCount: number;
    failedCount: number;
    error?: string;
    retryCount?: number;
  }> = [];

  let elapsedBudgetExceeded = false;

  for (const bc of broadcasts) {
    // wall-clock guard: 予算 超過 なら 未 処理 の 残り は 次 の tick に 任せる。
    // ここ で break する と Vercel function timeout で 途中 打ち切り よりも 綺麗 に 抜けられる。
    if (Date.now() - tickStartedAt > TICK_TIME_BUDGET_MS) {
      elapsedBudgetExceeded = true;
      break;
    }
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
      tagIds: bc.target_filter.tagIds ?? null,
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
    let allSlicesRetryable = true; // 全 slice が 「retryable な エラー」 で 落ちた か
    let anySliceExecuted = false;

    for (let i = 0; i < userIds.length; i += SLICE_SIZE) {
      const slice = userIds.slice(i, i + SLICE_SIZE);
      const result = await multicastMessage(channel.channelAccessToken, slice, [message]);
      anySliceExecuted = true;
      if (result.ok) {
        sentCount += slice.length;
        allSlicesRetryable = false; // 1 slice でも 成功 したら リトライ すると 重複 送信 に なる
      } else {
        failedCount += slice.length;
        const cls = classifyLineError(result.status, result.message);
        lastErrorMessage = `${cls.kind}: ${cls.message}`;
        if (!cls.retryable) allSlicesRetryable = false;
        if (cls.kind === "quota_exceeded" || cls.kind === "unauthorized") {
          for (let j = i + SLICE_SIZE; j < userIds.length; j += SLICE_SIZE) {
            const remaining = userIds.slice(j, j + SLICE_SIZE);
            failedCount += remaining.length;
          }
          break;
        }
      }
    }

    // C2-2: 「全 slice が retryable エラー で 落ちた + sent が 0 + retry_count 未 到達」
    // の 場合 は 再試行 予約 に する。 部分 送信 済 の 配信 を リトライ する と 重複 送信
    // に なる ため、 sentCount > 0 の 場合 は 「一部 送信 済」 と して sent 扱い に する。
    const canRetry =
      anySliceExecuted &&
      sentCount === 0 &&
      failedCount > 0 &&
      allSlicesRetryable &&
      bc.retry_count < MAX_RETRIES;

    if (canRetry) {
      const backoffMs =
        RETRY_BACKOFF_MS[Math.min(bc.retry_count, RETRY_BACKOFF_MS.length - 1)] ?? 60_000;
      const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();
      await admin
        .from("line_broadcasts")
        .update({
          status: "queued",
          retry_count: bc.retry_count + 1,
          next_retry_at: nextRetryIso,
          last_error_at: new Date().toISOString(),
          error_message: lastErrorMessage,
        })
        .eq("id", bc.id);
      processed.push({
        id: bc.id,
        status: "queued(retry)",
        sentCount,
        failedCount,
        retryCount: bc.retry_count + 1,
        error: lastErrorMessage ?? undefined,
      });
      continue;
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
      retryCount: bc.retry_count,
      error: lastErrorMessage ?? undefined,
    });
  }

  const durationMs = Date.now() - tickStartedAt;
  // 停滞 検知 の ため に 集計 ログ を 残す (Vercel Function Logs)
  console.warn("[broadcasts-dispatch] tick summary", {
    fetched: broadcasts.length,
    processed: processed.length,
    remaining: broadcasts.length - processed.length,
    durationMs,
    budgetExceeded: elapsedBudgetExceeded,
  });

  return NextResponse.json({
    ok: true,
    processed: processed.length,
    fetched: broadcasts.length,
    remaining: broadcasts.length - processed.length,
    durationMs,
    budgetExceeded: elapsedBudgetExceeded,
    results: processed,
  });
}

export const GET = POST;

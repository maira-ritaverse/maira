import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { nextRetryDelayMs, syncOrganizationSeatCount } from "@/lib/billing/seat-sync";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/internal/billing/seat-reconcile
 *
 * 席 数 同期 の リカバリー cron。 10 分 おき に 叩かれる 想定。
 *
 * 処理 は 2 段 階:
 *
 *   A. seat_sync_failures テーブル に 積まれた 「失敗 リトライ キュー」 を 消化
 *      ・resolved_at IS NULL かつ next_retry_at <= now の 行 を 拾う
 *      ・syncOrganizationSeatCount を 再実行
 *      ・成功 → resolved_at 更新、 失敗 → retry_count + 1 & next_retry_at 更新
 *
 *   B. 「Webhook が 落ち て いた」 「レース で 通知 が 消えた」 等 で
 *      DB の seat_count と 実 メンバー 数 に ズレ が ある 組織 を 全 走査
 *      ・active な subscription を 持ち、 課金 免除 で ない 組織 を 全件 拾う
 *      ・syncOrganizationSeatCount を 呼ぶ (差分 なし の 組織 は no-op で 抜ける)
 *
 * 処理 件 数 は 過負荷 防止 の た め キャップ を 設ける (RETRY_LIMIT / RECONCILE_LIMIT)。
 */
export const dynamic = "force-dynamic";

const RETRY_LIMIT = 50;
const RECONCILE_LIMIT = 200;
const MAX_RETRIES = 4;

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

  // ============================================
  // A. リトライ キュー 消化
  // ============================================
  const { data: pending, error: pendingErr } = await admin
    .from("seat_sync_failures")
    .select("id, organization_id, retry_count")
    .is("resolved_at", null)
    .lte("next_retry_at", nowIso)
    .order("next_retry_at", { ascending: true })
    .limit(RETRY_LIMIT);

  if (pendingErr) {
    return NextResponse.json(
      { error: "fetch_failed_pending", message: pendingErr.message },
      { status: 500 },
    );
  }

  const pendingRows = pending ?? [];
  const retryStats = { attempted: 0, resolved: 0, deferred: 0, gaveUp: 0 };

  for (const row of pendingRows) {
    retryStats.attempted += 1;
    const result = await syncOrganizationSeatCount({
      organizationId: row.organization_id,
      reason: "cron_reconciliation",
    });

    if (result.ok) {
      await admin
        .from("seat_sync_failures")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", row.id);
      retryStats.resolved += 1;
      continue;
    }

    const nextCount = row.retry_count + 1;
    if (nextCount >= MAX_RETRIES) {
      // 打ち止め (人 手 対応 待ち)。 resolved_at は NULL の まま に して 監視 で 拾わせ る。
      await admin
        .from("seat_sync_failures")
        .update({
          retry_count: nextCount,
          error_message: `${result.error} [max_retries_reached]`,
        })
        .eq("id", row.id);
      retryStats.gaveUp += 1;
      continue;
    }

    const delay = nextRetryDelayMs(nextCount);
    await admin
      .from("seat_sync_failures")
      .update({
        retry_count: nextCount,
        next_retry_at: new Date(new Date(nowIso).getTime() + delay).toISOString(),
        error_message: result.error,
      })
      .eq("id", row.id);
    retryStats.deferred += 1;
  }

  // ============================================
  // B. 全 組織 の 差分 リコンサイル
  // ============================================
  const { data: orgs, error: orgsErr } = await admin
    .from("organization_plans")
    .select("organization_id")
    .in("status", ["trialing", "active", "past_due"])
    .eq("is_billing_exempt", false)
    .not("stripe_subscription_id", "is", null)
    .limit(RECONCILE_LIMIT);

  if (orgsErr) {
    return NextResponse.json(
      { error: "fetch_failed_orgs", message: orgsErr.message },
      { status: 500 },
    );
  }

  const reconcileStats = { scanned: 0, updated: 0, noChange: 0, failed: 0 };

  for (const row of orgs ?? []) {
    reconcileStats.scanned += 1;
    const result = await syncOrganizationSeatCount({
      organizationId: row.organization_id,
      reason: "cron_reconciliation",
    });
    if (!result.ok) {
      reconcileStats.failed += 1;
      continue;
    }
    if ("updated" in result) {
      reconcileStats.updated += 1;
    } else {
      reconcileStats.noChange += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    retry: retryStats,
    reconcile: reconcileStats,
  });
}

export const GET = POST;

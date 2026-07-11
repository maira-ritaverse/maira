/**
 * POST/GET /api/internal/ma/flow-dispatch
 *
 * ma_flow_subscriptions を 走査 し、 next_action_at 到来 分 を 実行 する cron エンドポイント。
 * Vercel Cron (1 分 毎) から 呼ばれ る 想定。
 *
 * 処理 フロー :
 *   1. status='active' かつ next_action_at <= now() の subscription を 200 件 まで 取得
 *   2. 1 件 ずつ executeSubscriptionTick で 1 ステップ 進め る
 *   3. 例外 は subscription 単位 で 捕捉 (全体 は 継続)
 *   4. 集計 を JSON で 返す
 *
 * 設計 : docs/line-lstep-ma-design.md §7.2
 */
import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import {
  executeSubscriptionTick,
  type SubscriptionRow,
  type TickResult,
} from "@/lib/ma/flow-executor";
import { createServiceClient } from "@/lib/supabase/service";

const BATCH_SIZE = 200;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    const status = auth.reason === "not_configured" ? 503 : 401;
    return NextResponse.json({ error: auth.reason }, { status });
  }

  const startedAt = Date.now();
  const supabase = createServiceClient();

  const nowIso = new Date().toISOString();
  const { data: subs, error: fetchErr } = await supabase
    .from("ma_flow_subscriptions")
    .select(
      "id, organization_id, flow_id, line_user_id, client_record_id, current_step_order, next_action_at, status, entered_at",
    )
    .eq("status", "active")
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    return NextResponse.json({ error: "fetch_failed", message: fetchErr.message }, { status: 500 });
  }

  const rows = (subs ?? []) as SubscriptionRow[];
  const counters = {
    processed: 0,
    progressed: 0,
    deferred: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
  const failures: Array<{ subscription_id: string; error: string }> = [];

  for (const sub of rows) {
    let result: TickResult;
    try {
      result = await executeSubscriptionTick(supabase, sub);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { kind: "failed", error: msg };
    }
    counters.processed++;
    switch (result.kind) {
      case "progressed":
        counters.progressed++;
        break;
      case "deferred":
        counters.deferred++;
        break;
      case "completed":
        counters.completed++;
        break;
      case "skipped":
        counters.skipped++;
        break;
      case "failed":
        counters.failed++;
        failures.push({ subscription_id: sub.id, error: result.error });
        break;
    }
  }

  return NextResponse.json({
    ok: true,
    ...counters,
    elapsed_ms: Date.now() - startedAt,
    // 失敗 は 最大 20 件 まで レスポンス に 含める (残り は logs で 追跡)
    failures: failures.slice(0, 20),
  });
}

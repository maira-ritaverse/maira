/**
 * POST/GET /api/internal/ma/segment-scan
 *
 * trigger_type='segment_matched' の active Flow に 対して、 target_segment_id で
 * 新規 マッチ し た 友達 を 検出 して enroll する 15 分 粒度 の cron。
 *
 * 処理 :
 *   1. is_active=true かつ trigger_type='segment_matched' かつ target_segment_id NOT NULL の Flow を 全 org 分 取得
 *   2. 各 Flow の セグメント filter を 実行 → 一致 友達 リスト
 *   3. 友達 ごと に enrollFriendToFlow (skipSegmentCheck=true で 再判定 回避)
 *   4. 集計 を JSON で 返す
 *
 * 冪等性 :
 *   ・ma_flow_subscriptions の partial unique (status IN active/paused) で
 *     重複 enroll を DB 側 で 拒否。 allow_reentry=false なら 過去 完了 も 拒否。
 *
 * 設計 : docs/line-lstep-ma-design.md §7.1 / phase1-plan §4.3
 */
import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { enrollFriendToFlow } from "@/lib/ma/flow-enroller";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 1 Flow あたり の 上限 (爆発 防止)。 超過 分 は 次 tick に 回る。 */
const MAX_ENROLLS_PER_FLOW = 200;

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

  const { data: flowsData, error: flowsErr } = await supabase
    .from("ma_flows")
    .select("id, organization_id, target_segment_id")
    .eq("is_active", true)
    .eq("trigger_type", "segment_matched")
    .not("target_segment_id", "is", null);

  if (flowsErr) {
    return NextResponse.json(
      { error: "fetch_flows_failed", message: flowsErr.message },
      { status: 500 },
    );
  }

  const flows = (flowsData ?? []) as Array<{
    id: string;
    organization_id: string;
    target_segment_id: string;
  }>;

  const counters = {
    flows_scanned: 0,
    friends_matched: 0,
    enrolled: 0,
    skipped: 0,
    failed: 0,
  };

  for (const flow of flows) {
    counters.flows_scanned++;

    // Segment の filter を 引く
    const { data: seg } = await supabase
      .from("line_segments")
      .select("filter_dsl_json")
      .eq("id", flow.target_segment_id)
      .maybeSingle();
    if (!seg) continue;

    // RPC で 一致 friend を 全件 取得
    const { data: matchesData, error: rpcErr } = await supabase.rpc(
      "select_friends_by_segment_filter",
      {
        p_organization_id: flow.organization_id,
        p_filter: seg.filter_dsl_json,
      },
    );
    if (rpcErr) {
      console.warn(`[segment-scan] rpc failed flow=${flow.id}`, rpcErr.message);
      continue;
    }

    const lineUserIds = ((matchesData ?? []) as Array<{ line_user_id: string }>).map(
      (r) => r.line_user_id,
    );
    counters.friends_matched += lineUserIds.length;

    const targets = lineUserIds.slice(0, MAX_ENROLLS_PER_FLOW);
    for (const lineUserId of targets) {
      try {
        const r = await enrollFriendToFlow(supabase, flow.id, lineUserId, {
          enteredVia: "trigger_auto",
          skipSegmentCheck: true, // 既に 一致 判定 済
        });
        if (r.kind === "enrolled") counters.enrolled++;
        else if (r.kind === "skipped") counters.skipped++;
        else counters.failed++;
      } catch (err) {
        counters.failed++;
        console.warn(`[segment-scan] enroll failed flow=${flow.id} user=${lineUserId}`, err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ...counters,
    elapsed_ms: Date.now() - startedAt,
  });
}

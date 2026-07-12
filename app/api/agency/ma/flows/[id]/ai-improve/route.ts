/**
 * POST /api/agency/ma/flows/[id]/ai-improve
 *
 * 指定 Flow を Claude に レビュー させ、 改善 提案 を 返す。
 *
 * 認可 :organization admin のみ、 対象 Flow が 自組織 の もの か 確認
 * 上限 :agency_ma_flow_improvement
 */
import { generateObject } from "ai";
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { assertAnthropicConfigured, getModel, MODELS } from "@/lib/ai/client";
import {
  AIFlowImprovementSchema,
  FLOW_IMPROVEMENT_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/flow-improvement";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { getFlowDetail } from "@/lib/ma/flow-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  try {
    assertAnthropicConfigured();
  } catch {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
  }

  const { id: flowId } = await context.params;

  const flow = await getFlowDetail(guard.supabase, guard.organization.id, flowId);
  if (!flow) return NextResponse.json({ error: "flow_not_found" }, { status: 404 });

  const usage = await checkAiUsageLimit(
    guard.supabase,
    guard.user.id,
    "agency_ma_flow_improvement",
  );
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "ai_limit_exceeded",
        message: `今月 の AI Flow 改善 提案 上限 (${usage.limit} 回) に 達しました。 リセット: ${usage.resetsAt}`,
        current: usage.current,
        limit: usage.limit,
      },
      { status: 429 },
    );
  }

  // Flow を 人間 が 読める 形式 で AI に 渡す
  const flowSnapshot = {
    name: flow.name,
    description: flow.description,
    trigger_type: flow.trigger_type,
    trigger_config: flow.trigger_config,
    goal_event_key: flow.goal_event_key,
    allow_reentry: flow.allow_reentry,
    max_send_per_day: flow.max_send_per_day,
    send_time_window_json: flow.send_time_window_json,
    steps: flow.steps.map((s) => ({
      step_order: s.step_order,
      name: s.name,
      delay_from_previous_seconds: s.delay_from_previous_seconds,
      action_type: s.action_type,
      action_config: s.action_config,
      // branch_condition_json は 定義 の 骨格 だけ 抽出 (bytes を 節約)
      branch_condition_summary: s.branch_condition_json ? "設定 済" : null,
      next_step_on_true: s.next_step_on_true,
      next_step_on_false: s.next_step_on_false,
    })),
  };

  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: AIFlowImprovementSchema,
      system: FLOW_IMPROVEMENT_SYSTEM_PROMPT,
      prompt: `<flow_data>\n${JSON.stringify(flowSnapshot, null, 2)}\n</flow_data>`,
    });

    await recordAiUsage(guard.supabase, guard.user.id, "agency_ma_flow_improvement");

    return NextResponse.json({ review: result.object });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "review_failed", message: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}

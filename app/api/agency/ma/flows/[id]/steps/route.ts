/**
 * /api/agency/ma/flows/[id]/steps
 *
 * GET  :自組織 の Flow の 全 ステップ を 返す
 * PUT  :ステップ を トランザクション 的 に 一括 置換
 *        (現行 削除 → 新規 INSERT)。 body で 全 ステップ を 送る。
 *
 * 認可 :
 *   ・GET:organization member
 *   ・PUT:organization admin のみ
 *
 * 設計 : docs/line-lstep-ma-phase1-plan.md §4.6
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ────────────────────────────────────────
// GET
// ────────────────────────────────────────
export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { id: flowId } = await context.params;

  // Flow が 自組織 に 属す か 確認
  const { data: flow } = await guard.supabase
    .from("ma_flows")
    .select("id")
    .eq("id", flowId)
    .eq("organization_id", guard.organization.id)
    .maybeSingle();
  if (!flow) return NextResponse.json({ error: "flow_not_found" }, { status: 404 });

  const { data: steps, error } = await guard.supabase
    .from("ma_flow_steps")
    .select("*")
    .eq("flow_id", flowId)
    .order("step_order", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ steps: steps ?? [] });
}

// ────────────────────────────────────────
// PUT (一括 置換)
// ────────────────────────────────────────
const stepSchema = z.object({
  step_order: z.number().int().min(1),
  name: z.string().nullable().optional(),
  delay_from_previous_seconds: z.number().int().min(0),
  action_type: z.enum([
    "send_message",
    "assign_tag",
    "remove_tag",
    "add_score",
    "set_field",
    "wait",
    "branch",
    "stop",
  ]),
  action_config: z.record(z.string(), z.unknown()).optional(),
  template_id: z.string().uuid().nullable().optional(),
  branch_condition_json: z.unknown().nullable().optional(),
  next_step_on_true: z.number().int().nullable().optional(),
  next_step_on_false: z.number().int().nullable().optional(),
  next_step_on_default: z.number().int().nullable().optional(),
  goal_check_on_entry: z.boolean().optional(),
  // Phase 1-F.2 自由 DAG エディタ:キャンバス 上 の 位置
  position_x: z.number().nullable().optional(),
  position_y: z.number().nullable().optional(),
});

const putBody = z.object({
  steps: z.array(stepSchema).max(50),
});

export async function PUT(request: Request, context: RouteContext) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const { id: flowId } = await context.params;
  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = putBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  // Flow が 自組織 か 確認 (別 org の 書き換え 防止)
  const { data: flow } = await admin
    .from("ma_flows")
    .select("id, organization_id")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow || flow.organization_id !== guard.organization.id) {
    return NextResponse.json({ error: "flow_not_found" }, { status: 404 });
  }

  // step_order の 重複 チェック
  const orders = parsed.data.steps.map((s) => s.step_order);
  if (new Set(orders).size !== orders.length) {
    return NextResponse.json({ error: "duplicate_step_order" }, { status: 400 });
  }

  // トランザクション 的 に 置換:全 削除 → INSERT
  // 注意 : 単一 リクエスト 内 で は 実質 逐次 だが、 その間 に cron が
  // 走って step を lookup すると 不整合 の 可能性。 頻度 と 影響 が 小さい ため 許容。
  const { error: delErr } = await admin.from("ma_flow_steps").delete().eq("flow_id", flowId);
  if (delErr) {
    return NextResponse.json({ error: "delete_failed", message: delErr.message }, { status: 500 });
  }

  if (parsed.data.steps.length > 0) {
    const rows = parsed.data.steps.map((s) => ({
      flow_id: flowId,
      step_order: s.step_order,
      name: s.name ?? null,
      delay_from_previous_seconds: s.delay_from_previous_seconds,
      action_type: s.action_type,
      action_config: s.action_config ?? {},
      template_id: s.template_id ?? null,
      branch_condition_json: s.branch_condition_json ?? null,
      next_step_on_true: s.next_step_on_true ?? null,
      next_step_on_false: s.next_step_on_false ?? null,
      next_step_on_default: s.next_step_on_default ?? null,
      goal_check_on_entry: s.goal_check_on_entry ?? false,
      position_x: s.position_x ?? null,
      position_y: s.position_y ?? null,
    }));
    const { error: insErr } = await admin.from("ma_flow_steps").insert(rows);
    if (insErr) {
      return NextResponse.json(
        { error: "insert_failed", message: insErr.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, step_count: parsed.data.steps.length });
}

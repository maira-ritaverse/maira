/**
 * POST /api/agency/ma/flows/[id]/dry-run
 *
 * 仮想友だちで Flow をシミュレーションし、タイムラインを返す。
 * DB への書き込み・LINE 送信は行わない(pure computation)。
 *
 * ・org_member であることを確認(admin 限定にしない — 検証用途)
 * ・Flow が自組織のものであることを確認
 * ・ma_flow_steps を DB から読み出して simulateFlow へ渡す
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserRole } from "@/lib/organizations/queries";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
import { simulateFlow, type SimStep, type VirtualFriend } from "@/lib/ma/flow-simulator";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const virtualFriendSchema = z.object({
  days_since_added: z.number().int().min(0).max(3650),
  days_since_last_activity: z.number().int().min(0).max(3650),
  tag_ids: z.array(z.string().uuid()).max(50).default([]),
  fields: z
    .array(z.object({ key: z.string().min(1).max(80), value: z.string().max(1000) }))
    .max(50)
    .default([]),
  conversion_events: z
    .array(
      z.object({
        event_key: z.string().min(1).max(80),
        days_ago: z.number().int().min(0).max(3650),
      }),
    )
    .max(50)
    .optional(),
  clicked_flow_ids: z.array(z.string().uuid()).max(50).optional(),
});

const bodySchema = z.object({
  virtual_friend: virtualFriendSchema,
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id: flowId } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // MA 機能 は Team 系 プラン 限定 (Solo 系 は 402)。
  const plan = await getCurrentOrganizationPlan(supabase);
  if (!getPlanEntitlements(plan?.tier ?? "standard").canUseMaFlows) {
    return NextResponse.json(
      {
        error: "feature_not_available",
        message: "マーケティングオートメーション機能はTeamプラン以上でご利用いただけます。",
      },
      { status: 402 },
    );
  }

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Flow の所有チェック
  const { data: flow } = await supabase
    .from("ma_flows")
    .select("id, organization_id")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow || flow.organization_id !== role.organization.id) {
    return NextResponse.json({ error: "flow_not_found" }, { status: 404 });
  }

  const { data: stepRows } = await supabase
    .from("ma_flow_steps")
    .select(
      "step_order, name, action_type, delay_from_previous_seconds, branch_condition_json, next_step_on_true, next_step_on_false, next_step_on_default",
    )
    .eq("flow_id", flowId)
    .order("step_order", { ascending: true });

  const steps: SimStep[] = (stepRows ?? []) as SimStep[];
  if (steps.length === 0) {
    return NextResponse.json({ result: { timeline: [], truncated: false } });
  }

  const virtual: VirtualFriend = parsed.data.virtual_friend;
  const result = simulateFlow(steps, virtual, new Date());
  return NextResponse.json({ result });
}

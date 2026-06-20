import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { PLAN_TIERS, type PlanTier } from "@/lib/billing/agency";

/**
 * POST /api/agency/billing/trial-upgrade-choice
 *
 * トライアル中 の admin が 「トライアル 終了後 継続したい アップグレード」を 保存。
 * 'standard' を 選んだ場合 は アップグレード解除 (NULL に 倒す) と 同義 で、
 * RPC 側 で 自動 NULL 化 する。
 *
 * RPC: set_trial_upgrade_choice(p_choice organization_plan_tier)
 *   ・admin 限定 (RPC 内で 検証)
 *   ・trialing 中 のみ (RPC 内で 検証)
 */
const bodySchema = z.object({
  choice: z.enum(PLAN_TIERS),
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const choice: PlanTier = parsed.data.choice;

  const { error } = await guard.supabase.rpc("set_trial_upgrade_choice", {
    p_choice: choice,
  });

  if (error) {
    // RPC で 'admin_required' / 'plan_not_trialing' などが 投げられる
    const code = error.message;
    const status = code === "admin_required" ? 403 : code === "plan_not_trialing" ? 409 : 500;
    return NextResponse.json({ error: code }, { status });
  }

  return NextResponse.json({ ok: true, choice });
}

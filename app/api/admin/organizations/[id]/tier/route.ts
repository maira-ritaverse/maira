import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { PLAN_TIERS } from "@/lib/billing/agency";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/organizations/[id]/tier
 *
 * 運営者(Myaira admin)が、組織のプラン tier を Team 系 ⇄ Solo 系 に切り替える。
 * organization_plans.tier を直接更新する運営者オーバーライド(Stripe 課金とは非同期。
 * 課金は別途 Stripe 側で調整する前提)。
 *
 * Auth: profiles.is_maira_admin = true のみ。
 */
const bodySchema = z.object({
  // PLAN_TIERS を zod enum に流用(値は tier-limits の PlanTierValue と一致)。
  tier: z.enum(PLAN_TIERS as unknown as [string, ...string[]]),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isMairaAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
  }
  const tier = parsed.data.tier;

  const admin = createServiceClient();
  // organization_id は PK。プラン行が無い組織でも tier を設定できるよう upsert。
  const { error } = await admin
    .from("organization_plans")
    .upsert({ organization_id: id, tier }, { onConflict: "organization_id" });
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  await recordAuditLog({
    userId: user.id,
    action: "subscription_changed",
    metadata: { organizationId: id, tier, via: "admin_tier_override" },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, tier });
}

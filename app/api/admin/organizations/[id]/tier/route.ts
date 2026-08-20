import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { PLAN_TIERS, SOLO_TIERS } from "@/lib/billing/agency";
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
// PLAN_TIERS は Team 系のみ。Solo 系(SOLO_TIERS)を合わせて全 tier を許可する。
const ALL_TIERS = [...PLAN_TIERS, ...SOLO_TIERS] as unknown as [string, ...string[]];
const bodySchema = z.object({
  tier: z.enum(ALL_TIERS),
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
  // ai_boost_enabled は CHECK 制約 org_plans_ai_boost_matches_tier_check
  //   (tier='standard_pro' <=> ai_boost_enabled=true)に一致させる必要がある。
  // tier だけ更新すると standard_pro への切替 / からの切替・新規挿入で必ず CHECK 違反 →
  // 500 になり「Standard + Pro」が選べず、Pro 組織を他 tier に戻すこともできなかった。
  // tier と ai_boost_enabled を必ずセットで更新する。
  const { error } = await admin
    .from("organization_plans")
    .upsert(
      { organization_id: id, tier, ai_boost_enabled: tier === "standard_pro" },
      { onConflict: "organization_id" },
    );
  if (error) {
    console.error("[admin/tier] update failed", { organizationId: id, message: error.message });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
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

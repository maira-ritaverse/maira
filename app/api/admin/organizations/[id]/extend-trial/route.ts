/**
 * POST /api/admin/organizations/[id]/extend-trial
 *
 * 組織のトライアル期間を N 日延長する admin 専用 API(billing-exempt と同型)。
 *
 * Body: { days: number }  // 1〜365 の整数
 * Auth: profiles.is_maira_admin = true のみ。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { extendOrganizationTrial, TRIAL_EXTEND_MAX_DAYS } from "@/lib/billing/trial";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  days: z.number().int().min(1).max(TRIAL_EXTEND_MAX_DAYS),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: organizationId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = await isMairaAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await extendOrganizationTrial({
    organizationId,
    days: parsed.data.days,
    actingUserId: user.id,
  });

  if (!result.ok) {
    // no_plan / invalid_days → 400、stripe_managed → 409、save_failed → 500
    const status =
      result.error === "save_failed" ? 500 : result.error === "stripe_managed" ? 409 : 400;
    if (result.error === "save_failed") {
      console.error("[extend-trial] failed", result.message);
    }
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }

  return NextResponse.json({ ok: true, newTrialEndsAt: result.newTrialEndsAt });
}

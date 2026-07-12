/**
 * /api/agency/reports/targets
 *
 * GET   : 直近 12 か月分の目標を返す
 * PUT   : YYYY-MM の目標を upsert(admin のみ)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("report_targets")
    .select(
      "year_month, placement_count_target, net_revenue_target, application_count_target, interview_count_target",
    )
    .eq("organization_id", guard.organization.id)
    .order("year_month", { ascending: false })
    .limit(24);

  return NextResponse.json({ targets: data ?? [] });
}

const putBody = z.object({
  year_month: z.string().regex(/^\d{4}-\d{2}$/),
  placement_count_target: z.number().int().min(0).max(9_999),
  net_revenue_target: z.number().int().min(0).max(9_999_999_999),
  application_count_target: z.number().int().min(0).max(9_999),
  interview_count_target: z.number().int().min(0).max(9_999),
});

export async function PUT(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = putBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { error } = await admin.from("report_targets").upsert(
    {
      organization_id: guard.organization.id,
      year_month: parsed.data.year_month,
      placement_count_target: parsed.data.placement_count_target,
      net_revenue_target: parsed.data.net_revenue_target,
      application_count_target: parsed.data.application_count_target,
      interview_count_target: parsed.data.interview_count_target,
      updated_by_user_id: guard.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,year_month" },
  );
  if (error) {
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

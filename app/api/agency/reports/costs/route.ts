/**
 * /api/agency/reports/costs
 *
 * GET   : 直近 12 か月分のコストを返す
 * PUT   : YYYY-MM のコストを upsert(admin のみ)
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
    .from("report_costs")
    .select("year_month, marketing_cost, tool_cost, personnel_cost, other_cost, memo")
    .eq("organization_id", guard.organization.id)
    .order("year_month", { ascending: false })
    .limit(24);

  return NextResponse.json({ costs: data ?? [] });
}

const putBody = z.object({
  year_month: z.string().regex(/^\d{4}-\d{2}$/),
  marketing_cost: z.number().int().min(0).max(9_999_999_999),
  tool_cost: z.number().int().min(0).max(9_999_999_999),
  personnel_cost: z.number().int().min(0).max(9_999_999_999),
  other_cost: z.number().int().min(0).max(9_999_999_999),
  memo: z.string().max(2000).nullable().optional(),
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
  const { error } = await admin.from("report_costs").upsert(
    {
      organization_id: guard.organization.id,
      year_month: parsed.data.year_month,
      marketing_cost: parsed.data.marketing_cost,
      tool_cost: parsed.data.tool_cost,
      personnel_cost: parsed.data.personnel_cost,
      other_cost: parsed.data.other_cost,
      memo: parsed.data.memo ?? null,
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

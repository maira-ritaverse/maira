import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";

/**
 * POST /api/agency/jobs/bulk
 *
 * 求人の一括ステータス変更。
 *   - set_status: open / paused / closed
 *
 * 認可:organization_member。RLS で自社のみ更新可能だが、explicit に
 * organization_id でも絞る(2 重防御)。
 */

const MAX_IDS = 200;

const setStatusSchema = z.object({
  action: z.literal("set_status"),
  ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
  status: z.enum(["open", "paused", "closed"]),
});

const requestSchema = z.discriminatedUnion("action", [setStatusSchema]);

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = requestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  if (parsed.data.action === "set_status") {
    const { data, error } = await supabase
      .from("job_postings")
      .update({ status: parsed.data.status })
      .in("id", parsed.data.ids)
      .eq("organization_id", organization.id)
      .select("id");
    if (error) {
      return NextResponse.json({ error: "Failed", message: error.message }, { status: 500 });
    }
    return NextResponse.json({ updated: (data ?? []).length });
  }

  return NextResponse.json({ updated: 0 });
}

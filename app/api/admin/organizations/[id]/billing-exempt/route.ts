/**
 * POST /api/admin/organizations/[id]/billing-exempt
 *
 * 組織 単位 で 「課金 免除」 を ON / OFF に トグル する admin 専用 API。
 *
 * Body:
 *   { exempt: boolean, reason?: string | null }
 *
 * Auth: profiles.is_maira_admin = true のみ。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { setBillingExemption } from "@/lib/billing/exemption";
import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  exempt: z.boolean(),
  reason: z.string().max(500).optional().nullable(),
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

  const result = await setBillingExemption({
    organizationId,
    isExempt: parsed.data.exempt,
    reason: parsed.data.reason?.trim() || null,
    actingUserId: user.id,
  });

  if (!result.ok) {
    console.error("[billing-exempt] failed", result.error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

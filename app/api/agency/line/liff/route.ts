import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/liff
 *
 * LIFF ID を 設定 / 解除 (admin 限定)。
 * 形式: "1234567890-AbCdEfGh" (LINE 公式 形式)。 null で 解除。
 */
const bodySchema = z.object({
  liffId: z
    .string()
    .regex(/^\d+-[A-Za-z0-9]+$/, "LIFF ID 形式 が 不正 です")
    .nullable(),
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

  const admin = createServiceClient();
  const { error } = await admin
    .from("line_channels")
    .update({ liff_id: parsed.data.liffId })
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, liffId: parsed.data.liffId });
}

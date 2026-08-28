import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { getHearingSheetTitle, setHearingSheetTitle } from "@/lib/hearing-sheet-questions/queries";

/**
 * /api/agency/hearing-sheet-settings
 *   GET   - ヒアリングシートのタイトル(メンバー)
 *   PATCH - タイトルを設定(admin のみ)
 */
const updateSettingsSchema = z.object({
  title: z.string().trim().min(1).max(100),
});

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const title = await getHearingSheetTitle(organization.id);
  return NextResponse.json({ title });
}

export async function PATCH(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = updateSettingsSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await setHearingSheetTitle(organization.id, parsed.data.title);
  if ("error" in result) {
    return NextResponse.json({ error: "Failed to update", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

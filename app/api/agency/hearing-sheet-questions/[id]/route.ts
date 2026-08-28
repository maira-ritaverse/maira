import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin } from "@/lib/api/auth-guards";
import {
  deleteHearingSheetQuestion,
  updateHearingSheetQuestion,
} from "@/lib/hearing-sheet-questions/queries";
import { updateHearingQuestionSchema } from "@/lib/hearing-sheet-questions/types";

/**
 * /api/agency/hearing-sheet-questions/[id]
 *   PATCH  - 質問を更新(key 以外)。admin のみ
 *   DELETE - 質問を削除。admin のみ(既存回答 JSON の該当キーは残る=無害)
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = updateHearingQuestionSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await updateHearingSheetQuestion(id, organization.id, parsed.data);
  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const result = await deleteHearingSheetQuestion(id, organization.id);
  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

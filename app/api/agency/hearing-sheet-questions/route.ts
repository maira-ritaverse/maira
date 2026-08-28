import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import {
  createHearingSheetQuestion,
  listHearingSheetQuestions,
} from "@/lib/hearing-sheet-questions/queries";
import { createHearingQuestionSchema } from "@/lib/hearing-sheet-questions/types";

/**
 * /api/agency/hearing-sheet-questions
 *   GET  - 組織の質問定義一覧(メンバー)
 *   POST - 質問を 1 件追加(admin のみ)
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const questions = await listHearingSheetQuestions(organization.id);
  return NextResponse.json({ questions });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createHearingQuestionSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await createHearingSheetQuestion(organization.id, parsed.data);
  if ("error" in result) {
    if (result.code === "23505") {
      return NextResponse.json({ error: "同じ key の質問が既に存在します" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create", message: result.error }, { status: 500 });
  }

  return NextResponse.json({ question: result }, { status: 201 });
}

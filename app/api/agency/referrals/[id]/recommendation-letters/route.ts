import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { getReferral } from "@/lib/referrals/queries";
import { createLetter, listLettersByReferral } from "@/lib/recommendation-letters/queries";
import { createRecommendationLetterRequestSchema } from "@/lib/recommendation-letters/types";

/**
 * /api/agency/referrals/[id]/recommendation-letters
 *   GET   - この referral に紐づく推薦文の履歴(version 降順、最新が先頭)
 *   POST  - 新しい推薦文バージョンを作成(初期 status=draft、空でも可)
 *
 * referral 自体の閲覧権限 = 推薦文の閲覧権限(RLS で organization_id 一致)。
 * referral が別組織のものなら getReferral で null になるため 404。
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: referralId } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  // referral が自社のものか確認(RLS でも保証されているが二重防御)
  const referral = await getReferral(referralId);
  if (!referral || referral.organizationId !== organization.id) {
    return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  }

  const letters = await listLettersByReferral(referralId, organization.id);
  return NextResponse.json({ letters });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: referralId } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member } = guard;

  const referral = await getReferral(referralId);
  if (!referral || referral.organizationId !== organization.id) {
    return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createRecommendationLetterRequestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await createLetter({
    referralId,
    organizationId: organization.id,
    memberId: member.id,
    headline: parsed.data.headline,
    body: parsed.data.body,
    templateId: parsed.data.template_id ?? null,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: "Failed to create recommendation letter", message: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json({ letter: result }, { status: 201 });
}

import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { notifyRecommendationLetterFinalized } from "@/lib/recommendation-letters/notify";
import { deleteLetter, getLetter, updateLetter } from "@/lib/recommendation-letters/queries";
import { updateRecommendationLetterRequestSchema } from "@/lib/recommendation-letters/types";

/**
 * /api/agency/recommendation-letters/[id]
 *   GET    - 1 件取得(本文 / 件名を復号して返す)
 *   PATCH  - 部分更新(自動保存 / 確定遷移)。finalized 済は 409 で弾く
 *   DELETE - admin のみ(履歴改ざん防止)
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const letter = await getLetter(id, organization.id);
  if (!letter) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ letter });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = updateRecommendationLetterRequestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await updateLetter({
    letterId: id,
    organizationId: organization.id,
    headline: parsed.data.headline,
    body: parsed.data.body,
    templateId: parsed.data.template_id,
    status: parsed.data.status,
  });

  if ("error" in result) {
    // finalized 済 / 存在しない場合のエラーコードに応じて HTTP ステータスを分ける
    if (result.code === "already_finalized") {
      return NextResponse.json({ error: result.error, code: "already_finalized" }, { status: 409 });
    }
    if (result.code === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update", message: result.error }, { status: 500 });
  }

  // 確定遷移(draft → finalized)を検出して求職者本人に in-app 通知を発火。
  // updateLetter は finalized 済を 409 で弾くので、ここに来た場合は今回の更新で
  // finalized になったとみなして良い(status を明示的に "finalized" に上書きしたケース)。
  if (parsed.data.status === "finalized" && result.status === "finalized") {
    // 通知失敗はログだけ。本フローは成功扱いで返す。
    void notifyRecommendationLetterFinalized({
      letterId: result.id,
      referralId: result.referralId,
      organizationId: organization.id,
    }).catch((err) => {
      console.error("[recommendation-letters/PATCH] notify failed", {
        letterId: result.id,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return NextResponse.json({ letter: result });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const result = await deleteLetter(id, organization.id);
  if (!result.ok) {
    return NextResponse.json({ error: "Failed to delete", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

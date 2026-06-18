import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import {
  deleteAgencyClientResume,
  getAgencyClientResume,
  updateAgencyClientResume,
} from "@/lib/agency-client-documents/queries";
import { updateAgencyClientResumeRequestSchema } from "@/lib/agency-client-documents/types";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET    /api/agency/client-resumes/[id]   1 件取得(復号後)
 * PATCH  /api/agency/client-resumes/[id]   部分更新
 * DELETE /api/agency/client-resumes/[id]   削除(admin のみ)
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;
  const { id } = await params;

  const item = await getAgencyClientResume(id, organization.id);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;
  const { id } = await params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = updateAgencyClientResumeRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 確定済(status=final)を draft に戻すのは許す(編集再開のため)が、
  // 「履歴改ざん」につながる重要な編集は status=draft でのみ可能とする運用案。
  // ここでは最低限のロックを掛けず、UI 側で「確定済の編集をする際は draft に戻す」
  // フローを推奨する(将来必要なら queries 側でガードを足す)。
  const result = await updateAgencyClientResume({
    id,
    organizationId: organization.id,
    title: parsed.data.title,
    documentDate: parsed.data.document_date,
    pii: parsed.data.pii,
    educationHistory: parsed.data.education_history,
    licenses: parsed.data.licenses,
    status: parsed.data.status,
    photoStoragePath: parsed.data.photo_storage_path,
  });

  if ("error" in result) {
    return NextResponse.json({ error: "update_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ item: result });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { organization } = guard;
  const { id } = await params;

  const result = await deleteAgencyClientResume(id, organization.id);
  if (!result.ok) {
    return NextResponse.json({ error: "delete_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

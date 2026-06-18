import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import {
  deleteAgencyClientCv,
  getAgencyClientCv,
  updateAgencyClientCv,
} from "@/lib/agency-client-documents/queries";
import { updateAgencyClientCvRequestSchema } from "@/lib/agency-client-documents/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;
  const { id } = await params;
  const item = await getAgencyClientCv(id, organization.id);
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
  const parsed = updateAgencyClientCvRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await updateAgencyClientCv({
    id,
    organizationId: organization.id,
    title: parsed.data.title,
    documentDate: parsed.data.document_date,
    body: parsed.data.body,
    relatedResumeId: parsed.data.related_resume_id,
    status: parsed.data.status,
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
  const result = await deleteAgencyClientCv(id, organization.id);
  if (!result.ok) {
    return NextResponse.json({ error: "delete_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

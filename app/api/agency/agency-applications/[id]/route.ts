import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import {
  deleteAgencyApplication,
  updateAgencyApplication,
} from "@/lib/agency-client-documents/queries";
import { updateAgencyApplicationRequestSchema } from "@/lib/agency-client-documents/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;
  const { id } = await params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = updateAgencyApplicationRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await updateAgencyApplication({
    id,
    organizationId: organization.id,
    details: parsed.data.details,
    status: parsed.data.status,
    appliedAt: parsed.data.applied_at,
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
  const result = await deleteAgencyApplication(id, organization.id);
  if (!result.ok) {
    return NextResponse.json({ error: "delete_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

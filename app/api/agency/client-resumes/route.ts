import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import {
  createAgencyClientResume,
  listAgencyClientResumes,
} from "@/lib/agency-client-documents/queries";
import { createAgencyClientResumeRequestSchema } from "@/lib/agency-client-documents/types";

/**
 * GET  /api/agency/client-resumes?client_record_id=...
 *   組織所有の履歴書を 1 クライアント分まとめて返す。
 * POST /api/agency/client-resumes
 *   新規作成。
 *
 * 認可:requireOrgMember(archived ガード込み)。
 * RLS と二重防御で organization_id を明示一致。
 */
export async function GET(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const url = new URL(request.url);
  const clientRecordId = url.searchParams.get("client_record_id");
  if (!clientRecordId) {
    return NextResponse.json({ error: "client_record_id is required" }, { status: 400 });
  }

  const items = await listAgencyClientResumes(clientRecordId, organization.id);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member, supabase } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = createAgencyClientResumeRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // cross-org record binding 防止 (from-recording と 同 パターン)
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("id, organization_id")
    .eq("id", parsed.data.client_record_id)
    .maybeSingle();
  if (
    !clientRow ||
    (clientRow as { organization_id: string }).organization_id !== organization.id
  ) {
    return NextResponse.json({ error: "client_record_not_in_organization" }, { status: 403 });
  }

  const result = await createAgencyClientResume({
    organizationId: organization.id,
    clientRecordId: parsed.data.client_record_id,
    createdByMemberId: member.id,
    title: parsed.data.title,
    documentDate: parsed.data.document_date ?? null,
    pii: parsed.data.pii,
    educationHistory: parsed.data.education_history,
    licenses: parsed.data.licenses,
  });

  if ("error" in result) {
    return NextResponse.json({ error: "create_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ item: result }, { status: 201 });
}

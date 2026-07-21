import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { createAgencyClientCv, listAgencyClientCvs } from "@/lib/agency-client-documents/queries";
import { clientRecordToCvBody } from "@/lib/agency-client-documents/client-record-to-document";
import { createAgencyClientCvRequestSchema } from "@/lib/agency-client-documents/types";
import { getClientRecordWithDecrypted } from "@/lib/clients/queries";

export async function GET(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const url = new URL(request.url);
  const clientRecordId = url.searchParams.get("client_record_id");
  if (!clientRecordId) {
    return NextResponse.json({ error: "client_record_id is required" }, { status: 400 });
  }

  const items = await listAgencyClientCvs(clientRecordId, organization.id);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createAgencyClientCvRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // cross-org 防止 + プロフィール自動反映のため復号込みで取得する。
  const client = await getClientRecordWithDecrypted(parsed.data.client_record_id);
  if (!client || client.organizationId !== organization.id) {
    return NextResponse.json({ error: "client_record_not_in_organization" }, { status: 403 });
  }

  // 明示指定が無い新規作成時は、顧客プロフィールから職務経歴書の本文を自動生成する。
  const result = await createAgencyClientCv({
    organizationId: organization.id,
    clientRecordId: parsed.data.client_record_id,
    createdByMemberId: member.id,
    title: parsed.data.title,
    documentDate: parsed.data.document_date ?? null,
    body: parsed.data.body ?? clientRecordToCvBody(client),
    relatedResumeId: parsed.data.related_resume_id ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: "create_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ item: result }, { status: 201 });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { getAgencyClientCv } from "@/lib/agency-client-documents/queries";

/**
 * POST /api/agency/client-cvs/[id]/push-to-seeker
 *
 * エージェント所有の職務経歴書を求職者(linked)に送付して受領待ちにする。
 * 同じく document_drafts_from_agency を使う。
 */
const bodySchema = z.object({ message: z.string().max(500).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, supabase, user } = guard;
  const { id: cvId } = await params;

  const cv = await getAgencyClientCv(cvId, organization.id);
  if (!cv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cv.status !== "final") {
    return NextResponse.json(
      { error: "not_finalized", message: "職務経歴書を「確定」してから送付してください" },
      { status: 409 },
    );
  }
  if (cv.pushedToDraftId) {
    return NextResponse.json(
      { error: "already_pushed", message: "既に送付済みです" },
      { status: 409 },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { data: cr } = await supabase
    .from("client_records")
    .select("link_status, organization_id")
    .eq("id", cv.clientRecordId)
    .maybeSingle();
  if (
    !cr ||
    (cr as { organization_id: string }).organization_id !== organization.id ||
    (cr as { link_status: string }).link_status !== "linked"
  ) {
    return NextResponse.json(
      { error: "not_linked", message: "求職者が未連携のため送付できません" },
      { status: 403 },
    );
  }

  const draftPayload = {
    motivation_note: undefined as string | undefined,
    self_pr: undefined as string | undefined,
    data: {
      summary: cv.body.summary,
      body: cv.body.body,
      source_agency_client_cv_id: cv.id,
    },
  };
  const encrypted = await encryptField(JSON.stringify(draftPayload));
  if (!encrypted) return NextResponse.json({ error: "encryption_failed" }, { status: 500 });

  const { data: inserted, error } = await supabase
    .from("document_drafts_from_agency")
    .insert({
      organization_id: organization.id,
      created_by_user_id: user.id,
      client_record_id: cv.clientRecordId,
      document_type: "cv",
      title: cv.title,
      encrypted_payload: encrypted,
      message: parsed.data.message ?? null,
      status: "submitted",
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return NextResponse.json(
      { error: "insert_failed", message: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  await supabase
    .from("agency_client_cvs")
    .update({ pushed_to_draft_id: (inserted as { id: string }).id })
    .eq("id", cv.id)
    .eq("organization_id", organization.id);

  return NextResponse.json({ ok: true, draft_id: (inserted as { id: string }).id });
}

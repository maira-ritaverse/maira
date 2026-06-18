import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import {
  getAgencyClientResume,
  updateAgencyClientResume,
} from "@/lib/agency-client-documents/queries";
import { z } from "zod";

/**
 * POST /api/agency/client-resumes/[id]/push-to-seeker
 *
 * エージェント所有の履歴書を「求職者に送付」して受領待ち状態にする。
 * 内部的には document_drafts_from_agency に行を追加し、resume 側の
 * pushed_to_draft_id に紐づける。
 *
 * 条件:
 *   ・履歴書が status='final'(下書き中はブロック)
 *   ・client_record が linked 状態
 *   ・既に push 済みなら 409 で防御(取り直しは draft を作り直す運用)
 *
 * 本フローは既存の document_drafts_from_agency パターンを再利用する。
 * seeker 側の受領は /app/agent-drafts(既存)で行う。
 */
const bodySchema = z.object({
  message: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, supabase, user } = guard;
  const { id: resumeId } = await params;

  const resume = await getAgencyClientResume(resumeId, organization.id);
  if (!resume) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (resume.status !== "final") {
    return NextResponse.json(
      { error: "not_finalized", message: "履歴書を「確定」してから送付してください" },
      { status: 409 },
    );
  }
  if (resume.pushedToDraftId) {
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

  // client_record が linked 状態か確認
  const { data: cr } = await supabase
    .from("client_records")
    .select("link_status, organization_id")
    .eq("id", resume.clientRecordId)
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

  // payload を構築:doc-drafts の loose schema に合わせる
  // pii + education_history + licenses をまとめて data として渡す
  const draftPayload = {
    motivation_note: resume.pii.motivation || undefined,
    self_pr: resume.pii.self_pr || undefined,
    data: {
      pii: resume.pii,
      education_history: resume.educationHistory,
      licenses: resume.licenses,
      photo_storage_path: resume.photoStoragePath,
      // 出元の参照
      source_agency_client_resume_id: resume.id,
    },
  };

  const encrypted = await encryptField(JSON.stringify(draftPayload));
  if (!encrypted) {
    return NextResponse.json({ error: "encryption_failed" }, { status: 500 });
  }

  const { data: inserted, error } = await supabase
    .from("document_drafts_from_agency")
    .insert({
      organization_id: organization.id,
      created_by_user_id: user.id,
      client_record_id: resume.clientRecordId,
      document_type: "resume",
      title: resume.title,
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

  // 履歴書側に push 済みフラグを反映
  const updateResult = await updateAgencyClientResume({
    id: resume.id,
    organizationId: organization.id,
  });
  if ("error" in updateResult) {
    // 万が一に備えて draft 行は残す。手動清掃可。
    return NextResponse.json(
      { error: "update_failed", message: updateResult.error },
      { status: 500 },
    );
  }
  // pushed_to_draft_id を service なしで update できないので明示的にもう 1 回
  // RLS 経由で UPDATE
  await supabase
    .from("agency_client_resumes")
    .update({ pushed_to_draft_id: (inserted as { id: string }).id })
    .eq("id", resume.id)
    .eq("organization_id", organization.id);

  return NextResponse.json({ ok: true, draft_id: (inserted as { id: string }).id });
}

import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createDraftRequestSchema, type CreateDraftRequest } from "@/lib/doc-drafts/types";

/**
 * POST /api/agency/document-drafts
 *
 * エージェントが求職者向けに書類ドラフトを作成して「提出」する。
 * 提出時の状態は status='submitted'(求職者が accept / reject できる状態)。
 */
export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, user } = guard;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = createDraftRequestSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", message: parsed.error.message.slice(0, 300) },
      { status: 400 },
    );
  }
  const d: CreateDraftRequest = parsed.data;

  // client_record が同組織所有 + linked 状態であることを RLS と合わせて再チェック
  const { data: cr, error: crErr } = await supabase
    .from("client_records")
    .select("id, organization_id, link_status")
    .eq("id", d.clientRecordId)
    .maybeSingle();
  if (crErr || !cr) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  if (
    (cr as { organization_id: string }).organization_id !== organization.id ||
    (cr as { link_status: string }).link_status !== "linked"
  ) {
    return NextResponse.json({ error: "not_linked" }, { status: 403 });
  }

  // 暗号化
  const encrypted = await encryptField(JSON.stringify(d.payload));
  if (!encrypted) {
    return NextResponse.json({ error: "encryption_failed" }, { status: 500 });
  }

  const { data: inserted, error } = await supabase
    .from("document_drafts_from_agency")
    .insert({
      organization_id: organization.id,
      created_by_user_id: user.id,
      client_record_id: d.clientRecordId,
      document_type: d.documentType,
      title: d.title,
      encrypted_payload: encrypted,
      message: d.message ?? null,
      status: "submitted",
    })
    .select("id, created_at, status")
    .single();
  if (error || !inserted) {
    return NextResponse.json(
      { error: "insert_failed", message: error?.message ?? "unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id: inserted.id, status: inserted.status });
}

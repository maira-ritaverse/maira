/**
 * 書類提出ドラフト(document_drafts_from_agency)の取得 + 復号
 *
 * - 求職者本人:自分宛のドラフト一覧
 * - エージェント:自社のドラフト一覧(将来用、今は API でも使わない)
 *
 * 暗号化された payload は本ヘルパで復号して呼び出し側に返す。
 * 復号失敗時は payload=null としてフィルタアウト(他の行は返す)。
 */
import { decryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

import {
  documentDraftPayloadSchema,
  type DocumentDraftRow,
  type DocumentDraftStatus,
  type DocumentDraftType,
} from "./types";

type RawRow = {
  id: string;
  organization_id: string;
  organizations: { name: string } | { name: string }[] | null;
  created_by_user_id: string | null;
  client_record_id: string;
  document_type: DocumentDraftType;
  title: string;
  encrypted_payload: string;
  status: DocumentDraftStatus;
  accepted_into_id: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  rescinded_at: string | null;
  message: string | null;
  created_at: string;
  updated_at: string;
};

function orgName(orgs: RawRow["organizations"]): string | null {
  if (!orgs) return null;
  return Array.isArray(orgs) ? (orgs[0]?.name ?? null) : (orgs?.name ?? null);
}

async function decryptAndShape(rows: RawRow[]): Promise<DocumentDraftRow[]> {
  const out: DocumentDraftRow[] = [];
  for (const r of rows) {
    let payload: DocumentDraftRow["payload"] = null;
    try {
      const plain = await decryptField(r.encrypted_payload);
      if (typeof plain === "string" && plain.length > 0) {
        const parsed = JSON.parse(plain) as unknown;
        const v = documentDraftPayloadSchema.safeParse(parsed);
        if (v.success) payload = v.data;
      }
    } catch {
      // 復号失敗:payload=null のままで残りを返す
    }
    out.push({
      id: r.id,
      organizationId: r.organization_id,
      organizationName: orgName(r.organizations),
      createdByUserId: r.created_by_user_id,
      createdByName: null, // profiles 経由の join は省略(必要なら別途)
      clientRecordId: r.client_record_id,
      documentType: r.document_type,
      title: r.title,
      status: r.status,
      payload,
      acceptedIntoId: r.accepted_into_id,
      acceptedAt: r.accepted_at,
      rejectedAt: r.rejected_at,
      rescindedAt: r.rescinded_at,
      message: r.message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return out;
}

/** 求職者本人:自分宛のドラフト一覧(最新順) */
export async function listSeekerDocumentDrafts(): Promise<DocumentDraftRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_drafts_from_agency")
    .select(
      "id, organization_id, organizations(name), created_by_user_id, client_record_id, document_type, title, encrypted_payload, status, accepted_into_id, accepted_at, rejected_at, rescinded_at, message, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listSeekerDocumentDrafts failed: ${error.message}`);
  }
  return decryptAndShape((data ?? []) as RawRow[]);
}

/** エージェント:自社のクライアント向けに送ったドラフト一覧 */
export async function listAgencyDocumentDraftsForClient(
  clientRecordId: string,
): Promise<DocumentDraftRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_drafts_from_agency")
    .select(
      "id, organization_id, organizations(name), created_by_user_id, client_record_id, document_type, title, encrypted_payload, status, accepted_into_id, accepted_at, rejected_at, rescinded_at, message, created_at, updated_at",
    )
    .eq("client_record_id", clientRecordId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listAgencyDocumentDraftsForClient failed: ${error.message}`);
  }
  return decryptAndShape((data ?? []) as RawRow[]);
}

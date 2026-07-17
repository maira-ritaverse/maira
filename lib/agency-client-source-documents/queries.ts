/**
 * agency_client_source_documents の CRUD ラッパ。
 *
 * すべて organization_id を 明示 で 絞る。 RLS でも 弾かれる が、 呼び出し 側 で
 * 誤って 他 org の ID を 渡した 場合 に 早めに 空 結果 を 返す 二重 防御 の 意図。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SourceDocument, SourceDocumentMime, SourceDocumentType } from "./types";

type DbRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  document_type: SourceDocumentType;
  file_name: string;
  mime_type: SourceDocumentMime;
  storage_path: string;
  file_size: number;
  uploaded_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

function toModel(row: DbRow): SourceDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    documentType: row.document_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    fileSize: row.file_size,
    uploadedByMemberId: row.uploaded_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  "id, organization_id, client_record_id, document_type, file_name, mime_type, storage_path, file_size, uploaded_by_member_id, created_at, updated_at";

export async function listSourceDocuments(
  supabase: SupabaseClient,
  args: { organizationId: string; clientRecordId: string },
): Promise<SourceDocument[]> {
  const { data, error } = await supabase
    .from("agency_client_source_documents")
    .select(SELECT_COLS)
    .eq("organization_id", args.organizationId)
    .eq("client_record_id", args.clientRecordId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DbRow[]).map(toModel);
}

export async function getSourceDocument(
  supabase: SupabaseClient,
  args: { organizationId: string; id: string },
): Promise<SourceDocument | null> {
  const { data, error } = await supabase
    .from("agency_client_source_documents")
    .select(SELECT_COLS)
    .eq("organization_id", args.organizationId)
    .eq("id", args.id)
    .maybeSingle();
  if (error) throw error;
  return data ? toModel(data as DbRow) : null;
}

export async function insertSourceDocument(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    clientRecordId: string;
    documentType: SourceDocumentType;
    fileName: string;
    mimeType: SourceDocumentMime;
    storagePath: string;
    fileSize: number;
    uploadedByMemberId: string | null;
  },
): Promise<SourceDocument> {
  const { data, error } = await supabase
    .from("agency_client_source_documents")
    .insert({
      organization_id: args.organizationId,
      client_record_id: args.clientRecordId,
      document_type: args.documentType,
      file_name: args.fileName,
      mime_type: args.mimeType,
      storage_path: args.storagePath,
      file_size: args.fileSize,
      uploaded_by_member_id: args.uploadedByMemberId,
    })
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    throw error ?? new Error("insert returned no data");
  }
  return toModel(data as DbRow);
}

export async function deleteSourceDocument(
  supabase: SupabaseClient,
  args: { organizationId: string; id: string },
): Promise<void> {
  const { error } = await supabase
    .from("agency_client_source_documents")
    .delete()
    .eq("organization_id", args.organizationId)
    .eq("id", args.id);
  if (error) throw error;
}

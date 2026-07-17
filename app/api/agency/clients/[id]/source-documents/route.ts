import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import {
  ALLOWED_MIME_TYPES,
  extensionFromMime,
  MAX_FILE_SIZE_BYTES,
  SOURCE_DOCUMENT_TYPES,
  STORAGE_BUCKET,
  type SourceDocumentMime,
  type SourceDocumentType,
} from "@/lib/agency-client-source-documents/types";
import {
  insertSourceDocument,
  listSourceDocuments,
} from "@/lib/agency-client-source-documents/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * /api/agency/clients/[id]/source-documents
 *
 *   GET  一覧
 *   POST 元書類 (履歴書 / 職務経歴書 / その他) の 元 ファイル を アップロード。
 *        multipart/form-data:
 *          - file        : Blob (application/pdf | image/jpeg | image/png、 20MB 以内)
 *          - documentType: "resume" | "cv" | "other" (省略 時 "other")
 *
 * 認可:
 *   ・requireOrgMember (archived org は 弾かれる)
 *   ・対象 client_record が 呼び出し ユーザー の 組織 に 属して いる こと を DB で 確認
 *   ・Storage への 書込 も RLS で path 先頭 = organization_id を 強制
 *
 * 実装 の 注意:
 *   ・ファイル は Storage → DB 行 挿入 の 順。 DB 挿入 が 失敗 したら Storage の
 *     オブジェクト を 削除 して ゴミ 残し を 防ぐ。
 *   ・ファイル 名 (元 の name) は そのまま 保存 して download 時 に 使う (ユーザー
 *     が 「田中太郎_職務経歴書.pdf」等 の 分かり やすい 名前 で 再取得 できる)。
 *   ・保存 path は 拡張子 のみ 決定的 に する (name の 揺れ を 吸収)。
 */
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

async function ensureClientBelongsToOrg(args: {
  clientRecordId: string;
  organizationId: string;
}): Promise<boolean> {
  const service = createServiceClient();
  const { data } = await service
    .from("client_records")
    .select("id")
    .eq("id", args.clientRecordId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(_request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { id: clientRecordId } = await params;
  const owned = await ensureClientBelongsToOrg({
    clientRecordId,
    organizationId: organization.id,
  });
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const docs = await listSourceDocuments(supabase, {
      organizationId: organization.id,
      clientRecordId,
    });
    return NextResponse.json({ documents: docs });
  } catch (err) {
    return NextResponse.json(
      { error: "internal", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const { id: clientRecordId } = await params;
  const owned = await ensureClientBelongsToOrg({
    clientRecordId,
    organizationId: organization.id,
  });
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file フィールドが必要です" }, { status: 400 });
  }

  const mime = file.type as SourceDocumentMime;
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    return NextResponse.json({ error: "対応形式は PDF / JPG / PNG のみです" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `ファイルサイズは ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB 以下にしてください` },
      { status: 400 },
    );
  }

  const rawDocType = formData.get("documentType");
  const documentType: SourceDocumentType =
    typeof rawDocType === "string" &&
    SOURCE_DOCUMENT_TYPES.includes(rawDocType as SourceDocumentType)
      ? (rawDocType as SourceDocumentType)
      : "other";

  // 元ファイル名は File インスタンス なら name プロパティ、 Blob なら "file.{ext}"。
  // 保存 & ダウンロード 時 の 表示 に そのまま 使う ため、 UTF-8 で 255 文字 以内 に
  // 切り詰める。 名前 未取得 の 場合 は fallback を 割り当てる。
  const originalName =
    file instanceof File && file.name && file.name.length > 0 && file.name.length <= 255
      ? file.name
      : `${documentType}.${extensionFromMime(mime)}`;

  const service = createServiceClient();

  // Storage path: {org_id}/{client_id}/{uuid}.{ext}
  // uuid は 事前 生成 して 「Storage 書込 で 使う id」 と 「DB 行 の id」 を 揃える。
  // これで download / delete で 一方 に しか 存在 しない 不整合 が 起きた 場合 に も
  // 手動 掃除 が しやすい (storage_path から DB id が 逆引き できる)。
  const docId = crypto.randomUUID();
  const ext = extensionFromMime(mime);
  const storagePath = `${organization.id}/${clientRecordId}/${docId}.${ext}`;

  // 1) Storage に upload。 upsert:false で 同 path の 上書き 防止 (uuid 由来 なので
  //    衝突 は 実質 起きない)。 service_role を 使う のは RLS を 通す 都合 上、
  //    「path 先頭 = 呼び出し ユーザー の org」 で ある こと を requireOrgMember の
  //    organization.id で 事前 に 検証 済 だから。
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await service.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: mime,
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: "upload_failed", message: uploadError.message },
      { status: 500 },
    );
  }

  // 2) DB 行 挿入。 失敗 したら Storage を rollback する。
  try {
    const doc = await insertSourceDocument(supabase, {
      organizationId: organization.id,
      clientRecordId,
      documentType,
      fileName: originalName,
      mimeType: mime,
      storagePath,
      fileSize: file.size,
      uploadedByMemberId: member.id,
    });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    // rollback
    await service.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath])
      .catch(() => {
        // rollback 失敗 は ログ のみ (元 の 挿入 失敗 の 方 を 優先 して 返す)
      });
    return NextResponse.json(
      {
        error: "insert_failed",
        message: err instanceof Error ? err.message : "Unknown",
      },
      { status: 500 },
    );
  }
}

/**
 * agency_client_source_documents の型定義
 *
 * 「エージェント が 求職者 の 既存 履歴書 / 職務経歴書 (PDF / 画像) を そのまま
 *  保存」 する 元書類。 バイナリ は Storage、 DB は メタ のみ。
 */
export type SourceDocumentType = "resume" | "cv" | "other";

export type SourceDocumentMime = "application/pdf" | "image/jpeg" | "image/png";

export const SOURCE_DOCUMENT_TYPES: SourceDocumentType[] = ["resume", "cv", "other"];
export const SOURCE_DOCUMENT_TYPE_LABELS: Record<SourceDocumentType, string> = {
  resume: "履歴書",
  cv: "職務経歴書",
  other: "その他",
};

export const ALLOWED_MIME_TYPES: readonly SourceDocumentMime[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const STORAGE_BUCKET = "agency-client-source-documents";

/** DB 行 の 型 (アプリ 側 で 扱う キャメル ケース) */
export type SourceDocument = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  documentType: SourceDocumentType;
  fileName: string;
  mimeType: SourceDocumentMime;
  storagePath: string;
  fileSize: number;
  uploadedByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * MIME から 拡張子 を 決める (Storage path の suffix 用)。
 * 拡張 は 元 file name から 取っても 良い が、 「.jpeg / .jpg」の 揺れ や 大小 の
 * 揺れ を 吸収 する ため MIME 由来 に 統一。
 */
export function extensionFromMime(mime: SourceDocumentMime): "pdf" | "jpg" | "png" {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg") return "jpg";
  return "png";
}

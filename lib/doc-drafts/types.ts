/**
 * エージェント → 求職者 書類提出ドラフトの型定義
 */
import { z } from "zod";

export type DocumentDraftType = "resume" | "cv";
export type DocumentDraftStatus = "draft" | "submitted" | "accepted" | "rejected" | "rescinded";

export const DOCUMENT_DRAFT_STATUS_LABEL: Record<DocumentDraftStatus, string> = {
  draft: "下書き",
  submitted: "受領待ち",
  accepted: "取り込み済み",
  rejected: "辞退済み",
  rescinded: "取下げ済み",
};

export const DOCUMENT_DRAFT_TYPE_LABEL: Record<DocumentDraftType, string> = {
  resume: "履歴書",
  cv: "職務経歴書",
};

/** ペイロード(復号後)の最低限の構造。詳細は resumes / cvs の既存型に従う。 */
export const documentDraftPayloadSchema = z.object({
  // 履歴書の場合の主要フィールド(motivation_note 等)を受け入れる loose 型
  motivation_note: z.string().optional(),
  self_pr: z.string().optional(),
  // 構造体(strengths / experiences など)は any として受ける(本人の resumes / cvs に
  // import する段階で適切な schema 検証を改めて行う)
  data: z.record(z.string(), z.unknown()).optional(),
});
export type DocumentDraftPayload = z.infer<typeof documentDraftPayloadSchema>;

export type DocumentDraftRow = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  clientRecordId: string;
  documentType: DocumentDraftType;
  title: string;
  status: DocumentDraftStatus;
  payload: DocumentDraftPayload | null;
  acceptedIntoId: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rescindedAt: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createDraftRequestSchema = z.object({
  clientRecordId: z.string().uuid(),
  documentType: z.enum(["resume", "cv"]),
  title: z.string().min(1).max(200),
  payload: documentDraftPayloadSchema,
  message: z.string().max(500).optional(),
});
export type CreateDraftRequest = z.infer<typeof createDraftRequestSchema>;

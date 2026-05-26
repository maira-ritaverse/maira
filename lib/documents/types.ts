import { z } from "zod";

/**
 * 書類タイプの定義
 *
 * - resume: 履歴書(JIS規格の項目別情報)
 * - cv: 職務経歴書(自由記述、経歴の詳細)
 * - motivation: 志望動機(求人別)
 * - self_pr: 自己PR(求人ベース or 一般用)
 */
export const documentTypes = ["resume", "cv", "motivation", "self_pr"] as const;
export type DocumentType = (typeof documentTypes)[number];

export const documentTypeLabels: Record<DocumentType, string> = {
  resume: "履歴書",
  cv: "職務経歴書",
  motivation: "志望動機",
  self_pr: "自己PR",
};

export const documentTypeDescriptions: Record<DocumentType, string> = {
  resume: "JIS規格に沿った項目別の履歴書情報",
  cv: "経歴・スキル・実績を時系列で詳述",
  motivation: "特定の求人に向けた志望動機",
  self_pr: "あなたの強みをアピールする自己PR",
};

/**
 * 書類タイプ別に求人情報が必須かどうか
 *
 * 志望動機・自己PRは求人情報があってこそ意味があるため必須。
 * 履歴書・職務経歴書は求人情報なしでも単体で成立する。
 */
export function requiresJobInfo(type: DocumentType): boolean {
  return type === "motivation" || type === "self_pr";
}

/**
 * 生成リクエストのバリデーションスキーマ
 */
export const generateDocumentRequestSchema = z.object({
  type: z.enum(documentTypes),
  jobInfo: z.string().optional(),
  customInstructions: z.string().optional(),
});

export type GenerateDocumentRequest = z.infer<typeof generateDocumentRequestSchema>;

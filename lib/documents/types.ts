import { z } from "zod";

/**
 * 書類タイプの定義
 *
 * - motivation: 志望動機(求人別)
 * - self_pr: 自己PR(求人ベース or 一般用)
 *
 * 履歴書 / 職務経歴書は /app/resumes / /app/cvs に移管したため
 * このモジュールでは扱わない(Phase A 整理)。
 * 過去の resume/cv レコードは、UI 側で getDocumentTypeLabel の
 * フォールバックを通して表示する。
 */
export const documentTypes = ["motivation", "self_pr"] as const;
export type DocumentType = (typeof documentTypes)[number];

export const documentTypeLabels: Record<DocumentType, string> = {
  motivation: "志望動機",
  self_pr: "自己PR",
};

export const documentTypeDescriptions: Record<DocumentType, string> = {
  motivation: "特定の求人に向けた志望動機",
  self_pr: "あなたの強みをアピールする自己PR",
};

/**
 * 書類タイプ別に求人情報が必須かどうか
 *
 * 志望動機・自己PRは求人情報があってこそ意味があるため必須。
 */
export function requiresJobInfo(type: DocumentType): boolean {
  return type === "motivation" || type === "self_pr";
}

/**
 * 旧タイプ('resume' / 'cv')を含む文字列からラベルを引く。
 *
 * 現行 documentTypes に含まれない値が来ても、UI に "undefined" を
 * 表示せず、ユーザーにわかる文言を返すためのフォールバック。
 * Phase A 整理で resume / cv を削除した後も、過去レコードが一覧/詳細に
 * 出る可能性があるためここで吸収する。
 */
export function getDocumentTypeLabel(type: string | undefined | null): string {
  if (!type) return "書類";
  if ((documentTypes as readonly string[]).includes(type)) {
    return documentTypeLabels[type as DocumentType];
  }
  // 旧タイプは別モジュール(/app/resumes・/app/cvs)へ移管済みの旨を明示
  if (type === "resume") return "履歴書(旧)";
  if (type === "cv") return "職務経歴書(旧)";
  return "書類";
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

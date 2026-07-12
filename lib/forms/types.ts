/**
 * フォーム(公開 Web フォーム)の型定義と Zod スキーマ。
 *
 * ・schema_json は「質問一覧の配列」。質問数が可変で index も不要のため、
 *   別テーブルにせず JSONB として扱う。
 * ・回答は AES-256-GCM で暗号化して保存(個人情報を含む可能性のため)。
 */
import { z } from "zod";

export const FormQuestionKindSchema = z.enum(["text", "textarea", "select"]);
export type FormQuestionKind = z.infer<typeof FormQuestionKindSchema>;

export const FormQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  kind: FormQuestionKindSchema,
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  /** select 用の選択肢 */
  options: z.array(z.string().min(1).max(120)).max(20).optional(),
});
export type FormQuestion = z.infer<typeof FormQuestionSchema>;

export const FormSchemaSchema = z.array(FormQuestionSchema).max(30);

export const FormRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  public_token: z.string(),
  is_published: z.boolean(),
  schema_json: FormSchemaSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type FormRow = z.infer<typeof FormRowSchema>;

export const CreateFormRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const UpdateFormRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  schema_json: FormSchemaSchema.optional(),
  is_published: z.boolean().optional(),
});

/** 送信ペイロード: qId → 回答文字列 */
export const SubmitFormRequestSchema = z.object({
  answers: z.record(z.string().min(1).max(40), z.string().max(4000)),
  /** LINE 連携済みユーザーからの submit の場合、クライアント側で取得した userId */
  line_user_id: z.string().max(80).optional(),
});

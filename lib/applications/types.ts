import { z } from "zod";

/**
 * 応募管理(applications)の型定義と Zod スキーマ
 *
 * DB スキーマ:
 * - encrypted_details(bytea): 会社名・職種など。JSON 文字列を bytea 化して保存
 * - status / applied_at / next_action_at / is_archived: メタデータ(平文)
 *
 * Week 3 で encrypted_details は本物の暗号文に置き換わる。
 * その際もアプリケーションレイヤーから見た型(Application / ApplicationDetails)は変わらない想定。
 */

/**
 * 応募ステータス(DB の application_status enum と一致)
 */
export const applicationStatuses = [
  "considering",
  "applied",
  "document_review",
  "interview",
  "offer",
  "rejected",
  "declined",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  considering: "検討中",
  applied: "応募済",
  document_review: "書類選考中",
  interview: "面接中",
  offer: "内定",
  rejected: "不採用",
  declined: "辞退",
  withdrawn: "取り下げ",
};

/**
 * 応募の暗号化対象データ(JSON 構造)
 *
 * 会社名・職種は必須、URL や年収などは任意。
 * job_url は空文字も許容するため `.or(z.literal(""))` を入れている。
 */
export const applicationDetailsSchema = z.object({
  company: z.string().min(1, "会社名は必須です"),
  position: z.string().min(1, "職種は必須です"),
  job_url: z.string().url().optional().or(z.literal("")),
  notes: z.string().optional(),
  salary_range: z.string().optional(),
  location: z.string().optional(),
});

export type ApplicationDetails = z.infer<typeof applicationDetailsSchema>;

/**
 * 応募の完全な情報(DB から復号して取得した形)
 */
export type Application = {
  id: string;
  details: ApplicationDetails;
  status: ApplicationStatus;
  applied_at: string | null;
  next_action_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * 応募の新規作成リクエスト
 */
export const createApplicationRequestSchema = z.object({
  details: applicationDetailsSchema,
  status: z.enum(applicationStatuses).optional().default("considering"),
  applied_at: z.string().optional().nullable(),
  next_action_at: z.string().optional().nullable(),
});

export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>;

/**
 * 応募の更新リクエスト
 */
export const updateApplicationRequestSchema = z.object({
  details: applicationDetailsSchema.optional(),
  status: z.enum(applicationStatuses).optional(),
  applied_at: z.string().optional().nullable(),
  next_action_at: z.string().optional().nullable(),
  is_archived: z.boolean().optional(),
});

export type UpdateApplicationRequest = z.infer<typeof updateApplicationRequestSchema>;

/**
 * メールテンプレート(email_templates)の型 + zod スキーマ
 *
 * DB スキーマは supabase/migrations/20260615190001_add_email_templates.sql。
 * 変数差替え:{client_name} / {advisor_name} / {organization_name}
 *  → ダイアログ側で差し替えを行う(本ファイルは保存形式のみ責任)。
 */
import { z } from "zod";

export type EmailTemplate = {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  body: string;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const createEmailTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

export type CreateEmailTemplateRequest = z.infer<typeof createEmailTemplateSchema>;

export const updateEmailTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
});

export type UpdateEmailTemplateRequest = z.infer<typeof updateEmailTemplateSchema>;

type EmailTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  subject: string;
  body: string;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToEmailTemplate(row: EmailTemplateRow): EmailTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

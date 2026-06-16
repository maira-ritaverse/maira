/**
 * 顧客向け埋め込みフォーム(intake_forms)の型 + zod スキーマ
 */
import { z } from "zod";

export type IntakeForm = {
  id: string;
  organizationId: string;
  token: string;
  name: string;
  entrySite: string | null;
  isActive: boolean;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

type IntakeFormRow = {
  id: string;
  organization_id: string;
  token: string;
  name: string;
  entry_site: string | null;
  is_active: boolean;
  created_by_member_id: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToIntakeForm(row: IntakeFormRow): IntakeForm {
  return {
    id: row.id,
    organizationId: row.organization_id,
    token: row.token,
    name: row.name,
    entrySite: row.entry_site,
    isActive: row.is_active,
    createdByMemberId: row.created_by_member_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 管理画面側
export const createIntakeFormSchema = z.object({
  name: z.string().min(1).max(100),
  entrySite: z.string().max(100).nullable().optional(),
});
export type CreateIntakeFormRequest = z.infer<typeof createIntakeFormSchema>;

export const updateIntakeFormSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  entrySite: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateIntakeFormRequest = z.infer<typeof updateIntakeFormSchema>;

// 公開フォーム側(顧客からの送信)
export const publicIntakeSubmitSchema = z.object({
  name: z.string().min(1, "お名前を入力してください").max(100),
  nameKana: z.string().max(100).optional().or(z.literal("")),
  email: z.string().email("メールアドレスを正しく入力してください").max(254),
  phone: z.string().max(20).optional().or(z.literal("")),
  prefecture: z.string().max(20).optional().or(z.literal("")),
  // カンマ区切り → サーバー側で配列化
  desiredLocations: z.string().max(500).optional().or(z.literal("")),
  desiredAnnualIncome: z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : undefined;
  }, z.number().min(0).max(99999).optional()),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
export type PublicIntakeSubmitRequest = z.infer<typeof publicIntakeSubmitSchema>;

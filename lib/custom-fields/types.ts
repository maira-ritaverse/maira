/**
 * カスタムフィールド(client_custom_field_definitions)の型 + zod スキーマ
 *
 * key は変数名規約(英小文字 + 数字 + アンダースコア、英字始まり)。
 * UI 上はラベルで表示し、内部キー(key)は client_records.custom_fields の JSON キーになる。
 */
import { z } from "zod";

export type CustomFieldType = "text" | "number" | "date" | "select" | "boolean";

export type CustomFieldDefinition = {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  isRequired: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  field_type: string;
  options: string[] | null;
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export function rowToCustomFieldDefinition(row: Row): CustomFieldDefinition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    key: row.key,
    label: row.label,
    fieldType: row.field_type as CustomFieldType,
    options: row.options ?? [],
    isRequired: row.is_required,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const keyRegex = /^[a-z][a-z0-9_]*$/;

export const createCustomFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(keyRegex, "英小文字始まり、英数字とアンダースコアのみ使用可"),
  label: z.string().min(1).max(100),
  fieldType: z.enum(["text", "number", "date", "select", "boolean"]),
  options: z.array(z.string().min(1).max(100)).max(50).default([]),
  isRequired: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreateCustomFieldRequest = z.infer<typeof createCustomFieldSchema>;

export const updateCustomFieldSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  fieldType: z.enum(["text", "number", "date", "select", "boolean"]).optional(),
  options: z.array(z.string().min(1).max(100)).max(50).optional(),
  isRequired: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});
export type UpdateCustomFieldRequest = z.infer<typeof updateCustomFieldSchema>;

/**
 * 1 行の値を type に応じて zod で validate するヘルパ(client_records 更新時に使う)。
 * unknown 入力 → 型に整形した値 / null / バリデーションエラー を返す。
 */
export function validateValue(
  def: Pick<CustomFieldDefinition, "fieldType" | "options" | "isRequired">,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") {
    if (def.isRequired) return { ok: false, error: "必須項目です" };
    return { ok: true, value: null };
  }
  switch (def.fieldType) {
    case "text": {
      if (typeof raw !== "string") return { ok: false, error: "文字列を入力してください" };
      if (raw.length > 1000) return { ok: false, error: "1000 文字以内で入力してください" };
      return { ok: true, value: raw };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: "数値を入力してください" };
      return { ok: true, value: n };
    }
    case "date": {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return { ok: false, error: "YYYY-MM-DD 形式で入力してください" };
      }
      return { ok: true, value: raw };
    }
    case "select": {
      if (typeof raw !== "string") return { ok: false, error: "選択肢から選んでください" };
      if (!def.options.includes(raw)) return { ok: false, error: "選択肢にない値です" };
      return { ok: true, value: raw };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return { ok: false, error: "true / false を入力してください" };
      return { ok: true, value: raw };
    }
  }
}

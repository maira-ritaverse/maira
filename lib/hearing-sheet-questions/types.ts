/**
 * ヒアリングシートの質問定義(組織別カスタマイズ)の型・スキーマ。
 *
 * hearing_sheet_question_definitions テーブルに対応。値の暗号化はしない
 * (定義=テンプレートであり機密ではない。回答本体は hearing_sheets.encrypted_content)。
 *
 * maps_to_pii は agency 側 ResumePii のキーに一致させる(②B の流し込み先)。
 */
import { z } from "zod";

/** 回答を流し込める本人情報(ResumePii)キー。lib/agency-client-documents の resumePiiSchema と一致。 */
export const HEARING_PII_TARGETS = [
  "full_name",
  "full_name_kana",
  "birth_date",
  "gender",
  "postal_code",
  "address",
  "address_kana",
  "phone",
  "email",
  "motivation",
  "self_pr",
  "preferences",
] as const;

export type HearingPiiTarget = (typeof HEARING_PII_TARGETS)[number];

/** 管理 UI のプルダウン表示用ラベル。 */
export const HEARING_PII_TARGET_LABELS: Record<HearingPiiTarget, string> = {
  full_name: "氏名",
  full_name_kana: "氏名(カナ)",
  birth_date: "生年月日",
  gender: "性別",
  postal_code: "郵便番号",
  address: "住所",
  address_kana: "住所(カナ)",
  phone: "電話番号",
  email: "メールアドレス",
  motivation: "志望動機",
  self_pr: "自己PR",
  preferences: "本人希望記入欄",
};

export type HearingQuestionInputType = "text" | "textarea";

/** DB 行(snake_case)。 */
export type HearingQuestionRow = {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  help_text: string | null;
  input_type: HearingQuestionInputType;
  max_length: number;
  maps_to_pii: HearingPiiTarget | null;
  display_order: number;
  created_at: string;
  updated_at: string;
};

/** アプリ表現(camelCase)。 */
export type HearingQuestionDefinition = {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  helpText: string | null;
  inputType: HearingQuestionInputType;
  maxLength: number;
  mapsToPii: HearingPiiTarget | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export function rowToHearingQuestion(row: HearingQuestionRow): HearingQuestionDefinition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    key: row.key,
    label: row.label,
    helpText: row.help_text,
    inputType: row.input_type,
    maxLength: row.max_length,
    mapsToPii: row.maps_to_pii,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** key は英小文字始まり + 英数 / アンダースコア(DB の check と一致)。 */
export const hearingQuestionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "key は英小文字で始まる英数字とアンダースコアのみ使えます")
  .max(50);

export const createHearingQuestionSchema = z.object({
  key: hearingQuestionKeySchema,
  label: z.string().trim().min(1).max(100),
  help_text: z.string().max(500).nullable().optional(),
  input_type: z.enum(["text", "textarea"]).default("textarea"),
  max_length: z.number().int().min(1).max(8000).default(2000),
  maps_to_pii: z.enum(HEARING_PII_TARGETS).nullable().optional(),
  display_order: z.number().int().min(0).max(9999).default(0),
});
export type CreateHearingQuestionInput = z.infer<typeof createHearingQuestionSchema>;

// 更新は key 以外を任意で。key は作成後に変更不可(回答 JSON のキーと連動するため)。
export const updateHearingQuestionSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  help_text: z.string().max(500).nullable().optional(),
  input_type: z.enum(["text", "textarea"]).optional(),
  max_length: z.number().int().min(1).max(8000).optional(),
  maps_to_pii: z.enum(HEARING_PII_TARGETS).nullable().optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
});
export type UpdateHearingQuestionInput = z.infer<typeof updateHearingQuestionSchema>;

/**
 * 標準 11 項目(会議録音の抽出キー = extraction-to-hearing の出力キーと一致)。
 *
 * 用途:定義が 0 件の org でもヒアリングシートが空にならないよう、
 * listHearingSheetQuestions が DB 空のときにこれを合成して返す(二重防御。
 * 通常はマイグレーションの backfill / seed トリガーで DB に materialize 済み)。
 *
 * DB のマイグレーション(20260828000002)の seed と同じ内容を保つこと。
 */
export const STANDARD_HEARING_QUESTIONS: ReadonlyArray<{
  key: string;
  label: string;
  inputType: HearingQuestionInputType;
  maxLength: number;
  displayOrder: number;
}> = [
  { key: "current_job", label: "現職", inputType: "textarea", maxLength: 2000, displayOrder: 10 },
  {
    key: "job_change_reason",
    label: "転職理由",
    inputType: "textarea",
    maxLength: 2000,
    displayOrder: 20,
  },
  { key: "strengths", label: "強み", inputType: "textarea", maxLength: 2000, displayOrder: 30 },
  {
    key: "weaknesses",
    label: "弱み・課題",
    inputType: "textarea",
    maxLength: 2000,
    displayOrder: 40,
  },
  {
    key: "desired_industry",
    label: "希望業種",
    inputType: "textarea",
    maxLength: 500,
    displayOrder: 50,
  },
  {
    key: "desired_position",
    label: "希望職種",
    inputType: "textarea",
    maxLength: 500,
    displayOrder: 60,
  },
  {
    key: "desired_location",
    label: "希望勤務地",
    inputType: "textarea",
    maxLength: 500,
    displayOrder: 70,
  },
  {
    key: "desired_salary",
    label: "希望年収",
    inputType: "textarea",
    maxLength: 200,
    displayOrder: 80,
  },
  {
    key: "motivation",
    label: "動機・志望",
    inputType: "textarea",
    maxLength: 2000,
    displayOrder: 90,
  },
  {
    key: "availability",
    label: "入社可能時期",
    inputType: "textarea",
    maxLength: 500,
    displayOrder: 100,
  },
  {
    key: "notes",
    label: "メモ(自由記述)",
    inputType: "textarea",
    maxLength: 4000,
    displayOrder: 110,
  },
];

/** 既定のシートタイトル(organization_hearing_sheet_settings に行が無い org 用)。 */
export const DEFAULT_HEARING_SHEET_TITLE = "ヒアリングシート";

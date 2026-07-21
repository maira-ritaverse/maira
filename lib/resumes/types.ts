import { z } from "zod";

/**
 * 履歴書(構造化データ、厚労省推奨様式 2021〜 準拠)の型定義
 *
 * 既存の lib/documents/types.ts(AI生成テキストの書類)とは別物。
 * こちらは項目ごとに構造化されたデータ。将来 PDF 出力に使う。
 */

// ============================================
// 性別(厚労省様式で任意)
// ============================================
export type Gender = "male" | "female" | "unspecified";

export const genderLabels: Record<Gender, string> = {
  male: "男",
  female: "女",
  unspecified: "記入しない",
};

// ============================================
// 学歴・職歴の1行
//
// year/month は数値で持つ。null も許容(月だけ未確定など下書きを許すため)。
// description には「学歴」「職歴」の見出し行や、入学/卒業/入社/退社に加え、
// 退職理由・自己PR 等の自由記述も書く運用が実態のため max を広めに取る。
// year/month は null 許容なので、年月のない自由記述だけの行も作れる。
// ============================================
export const educationItemSchema = z.object({
  year: z.number().int().min(1950).max(2100).nullable(),
  month: z.number().int().min(1).max(12).nullable(),
  description: z.string().max(500),
});
export type EducationItem = z.infer<typeof educationItemSchema>;

// ============================================
// 免許・資格の1行
// ============================================
export const licenseItemSchema = z.object({
  year: z.number().int().min(1950).max(2100).nullable(),
  month: z.number().int().min(1).max(12).nullable(),
  name: z.string().max(200),
});
export type LicenseItem = z.infer<typeof licenseItemSchema>;

// ============================================
// アプリ内で扱う Resume(camelCase)
//
// DB の snake_case とは別。queries 層で変換する。
// ============================================
export type Resume = {
  id: string;
  userId: string;
  title: string;
  name: string | null;
  nameKana: string | null;
  birthDate: string | null;
  gender: Gender | null;
  postalCode: string | null;
  address: string | null;
  addressKana: string | null;
  phone: string | null;
  email: string | null;
  contactAddress: string | null;
  // 連絡先のふりがな・電話(現住所と異なる連絡先を使う場合)
  contactAddressKana: string | null;
  contactPhone: string | null;
  photoUrl: string | null;
  // 履歴書の「○年○月○日 現在」として表示する作成日/提出日。
  // null の場合はプレビュー/PDF 表示時に本日の日付にフォールバック。
  documentDate: string | null;
  educationHistory: EducationItem[];
  licenses: LicenseItem[];
  // 厚労省様式の自由記述欄(志望動機、特技、好きな学科、アピールポイント等)。
  // 本人希望記入欄(personalRequests)とは別の欄。
  motivationNote: string | null;
  personalRequests: string | null;
  createdAt: string;
  updatedAt: string;
};

// ============================================
// 保存リクエスト(新規・更新共通)
//
// 「途中まで入力して保存」(下書き)を許容するため、必須は title のみ。
// その他の項目は空文字 or 省略 OK にしてある。
//
// プロパティ名は API の受け口に合わせて snake_case にしている
// (DB カラム名と一致させると insert/update がそのまま渡せて楽)。
// ============================================
// .default() は zod の input/output 型を分岐させ react-hook-form の Resolver と
// 噛み合わなくなるため使わない。フォーム側 buildDefaultValues で必ず初期値を渡す前提。
export const saveResumeRequestSchema = z.object({
  title: z.string().min(1, "タイトルは必須です").max(100),
  name: z.string().max(100).optional().or(z.literal("")),
  name_kana: z.string().max(100).optional().or(z.literal("")),
  birth_date: z.string().optional().or(z.literal("")), // YYYY-MM-DD
  gender: z.enum(["male", "female", "unspecified"]).nullable().optional(),
  postal_code: z.string().max(10).optional().or(z.literal("")),
  address: z.string().max(200).optional().or(z.literal("")),
  address_kana: z.string().max(200).optional().or(z.literal("")),
  phone: z.string().max(20).optional().or(z.literal("")),
  // メール:未入力は許可(空文字 or 省略)、入力されている場合のみ形式チェック
  email: z.string().email("メール形式が正しくありません").optional().or(z.literal("")),
  contact_address: z.string().max(200).optional().or(z.literal("")),
  contact_address_kana: z.string().max(200).optional().or(z.literal("")),
  contact_phone: z.string().max(20).optional().or(z.literal("")),
  // 履歴書の作成日(右上「現在」表示用)。空文字なら今日の日付にフォールバック。
  document_date: z.string().optional().or(z.literal("")), // YYYY-MM-DD
  education_history: z.array(educationItemSchema),
  licenses: z.array(licenseItemSchema),
  motivation_note: z.string().max(1000).optional().or(z.literal("")),
  personal_requests: z.string().max(1000).optional().or(z.literal("")),
});

export type SaveResumeRequest = z.infer<typeof saveResumeRequestSchema>;

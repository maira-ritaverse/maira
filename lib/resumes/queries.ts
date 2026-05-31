import { createClient } from "@/lib/supabase/server";
import {
  educationItemSchema,
  licenseItemSchema,
  type EducationItem,
  type Gender,
  type LicenseItem,
  type Resume,
  type SaveResumeRequest,
} from "./types";

/**
 * resumes テーブルの CRUD ヘルパー
 *
 * いずれの関数も userId を引数で取り、RLS と独立してアプリ側でも
 * 所有者一致で絞り込む(防御的二重チェック)。
 *
 * 暗号化は未実装(CLAUDE.md の方針通り、後でまとめて対応)。
 */

// ============================================
// 一覧取得
// ============================================
export async function listResumes(userId: string): Promise<Resume[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list resumes: ${error.message}`);
  }

  return (data ?? []).map(mapResumeRow);
}

// ============================================
// 単一取得
// ============================================
export async function getResume(resumeId: string, userId: string): Promise<Resume | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return mapResumeRow(data);
}

// ============================================
// 新規作成
//
// 入力は snake_case の SaveResumeRequest をそのまま使う。
// 空文字は null に正規化して DB に入れる(後で「未入力かどうか」を
// is null で判定しやすくする)。
// ============================================
export async function createResume(userId: string, input: SaveResumeRequest): Promise<string> {
  const supabase = await createClient();

  const row = {
    user_id: userId,
    ...normalizeSaveInput(input),
  };

  const { data, error } = await supabase.from("resumes").insert(row).select("id").single();

  if (error || !data) {
    throw new Error(`Failed to create resume: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

// ============================================
// 更新(全項目を上書き)
//
// PATCH だが履歴書は項目が多く、フォームから常に全項目送る前提なので
// 部分更新ではなく全体上書きで扱う。下書き保存と相性が良い。
// ============================================
export async function updateResume(
  resumeId: string,
  userId: string,
  input: SaveResumeRequest,
): Promise<void> {
  const supabase = await createClient();

  const updates = {
    ...normalizeSaveInput(input),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("resumes")
    .update(updates)
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update resume: ${error.message}`);
  }
}

// ============================================
// 削除
// ============================================
export async function deleteResume(resumeId: string, userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete resume: ${error.message}`);
  }
}

// ============================================
// 所有者確認(RLS とは別の明示的なガード)
// ============================================
export async function verifyResumeOwner(resumeId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("resumes")
    .select("user_id")
    .eq("id", resumeId)
    .maybeSingle();

  return data?.user_id === userId;
}

// ====================================================================
// 内部ヘルパー
// ====================================================================

type ResumeRow = {
  id: string;
  user_id: string;
  title: string;
  name: string | null;
  name_kana: string | null;
  birth_date: string | null;
  gender: string | null;
  postal_code: string | null;
  address: string | null;
  address_kana: string | null;
  phone: string | null;
  email: string | null;
  contact_address: string | null;
  contact_address_kana: string | null;
  contact_phone: string | null;
  photo_url: string | null;
  education_history: unknown;
  licenses: unknown;
  motivation_note: string | null;
  personal_requests: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * DB の行を Resume 型(camelCase)に変換する。
 *
 * jsonb の education_history / licenses は zod で安全にパースし、
 * 想定外のデータが混ざっていても UI が落ちないようにする。
 */
function mapResumeRow(row: ResumeRow): Resume {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    name: row.name,
    nameKana: row.name_kana,
    birthDate: row.birth_date,
    gender: isGender(row.gender) ? row.gender : null,
    postalCode: row.postal_code,
    address: row.address,
    addressKana: row.address_kana,
    phone: row.phone,
    email: row.email,
    contactAddress: row.contact_address,
    contactAddressKana: row.contact_address_kana,
    contactPhone: row.contact_phone,
    photoUrl: row.photo_url,
    educationHistory: parseEducationHistory(row.education_history),
    licenses: parseLicenses(row.licenses),
    motivationNote: row.motivation_note,
    personalRequests: row.personal_requests,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female" || value === "unspecified";
}

function parseEducationHistory(value: unknown): EducationItem[] {
  if (!Array.isArray(value)) return [];
  const result: EducationItem[] = [];
  for (const item of value) {
    const parsed = educationItemSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

function parseLicenses(value: unknown): LicenseItem[] {
  if (!Array.isArray(value)) return [];
  const result: LicenseItem[] = [];
  for (const item of value) {
    const parsed = licenseItemSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

/**
 * 空文字を null に正規化し、DB に渡せる形に整える。
 *
 * education_history / licenses は jsonb なのでオブジェクトをそのまま渡せる。
 */
function normalizeSaveInput(input: SaveResumeRequest) {
  return {
    title: input.title,
    name: emptyToNull(input.name),
    name_kana: emptyToNull(input.name_kana),
    birth_date: emptyToNull(input.birth_date),
    gender: input.gender ?? null,
    postal_code: emptyToNull(input.postal_code),
    address: emptyToNull(input.address),
    address_kana: emptyToNull(input.address_kana),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    contact_address: emptyToNull(input.contact_address),
    contact_address_kana: emptyToNull(input.contact_address_kana),
    contact_phone: emptyToNull(input.contact_phone),
    education_history: input.education_history,
    licenses: input.licenses,
    motivation_note: emptyToNull(input.motivation_note),
    personal_requests: emptyToNull(input.personal_requests),
  };
}

function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import {
  deserializeResumePii,
  pickResumePii,
  serializeResumePii,
  type ResumePii,
} from "./pii-fields";
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
 * 暗号化境界(Step 3a):
 *   - 書き込み:dual-write
 *     既存の個別 PII カラムへ従来どおり平文を書く + encrypted_pii にも
 *     PII を JSON 化して暗号化した文字列を書く。
 *     既存カラムをまだ削除しない理由 → 可逆性の確保。Step 3b の
 *     バックフィルと差分検証が終わるまで個別カラムを残す。
 *   - 読み取り:blob 優先 + 個別カラムへフォールバック
 *     encrypted_pii が非 null → 復号して PII 採用
 *     encrypted_pii が null    → 個別カラム(従来どおり)から採用
 *     どちらでも下流に返す Resume オブジェクトの形は完全に同一。
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

  // 復号は I/O ではなく純粋計算だが、Promise なので Promise.all でまとめる。
  return Promise.all((data ?? []).map(mapResumeRow));
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

  const normalized = normalizeSaveInput(input);
  const encryptedPii = await buildEncryptedPii(normalized);

  const row = {
    user_id: userId,
    ...normalized,
    encrypted_pii: encryptedPii,
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

  const normalized = normalizeSaveInput(input);
  const encryptedPii = await buildEncryptedPii(normalized);

  const updates = {
    ...normalized,
    encrypted_pii: encryptedPii,
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
  document_date: string | null;
  encrypted_pii: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * DB の行を Resume 型(camelCase)に変換する。
 *
 * 読み取り境界:
 *   - encrypted_pii が非 null → 復号 → blob 内の値を採用
 *   - encrypted_pii が null → 個別カラム(従来データ)からそのまま採用
 *
 * 復号に失敗したとき(壊れた blob / 鍵不一致など)は throw する。
 * fail-closed:平文を素通りさせると暗号化を回避できてしまうため、
 * 異常な状態はログを残して止める。
 */
async function mapResumeRow(row: ResumeRow): Promise<Resume> {
  const pii = await resolveResumePii(row);

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    name: pii.name,
    nameKana: pii.name_kana,
    birthDate: pii.birth_date,
    gender: pii.gender,
    postalCode: pii.postal_code,
    address: pii.address,
    addressKana: pii.address_kana,
    phone: pii.phone,
    email: pii.email,
    contactAddress: pii.contact_address,
    contactAddressKana: pii.contact_address_kana,
    contactPhone: pii.contact_phone,
    photoUrl: pii.photo_url,
    educationHistory: pii.education_history,
    licenses: pii.licenses,
    motivationNote: pii.motivation_note,
    personalRequests: pii.personal_requests,
    documentDate: row.document_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * blob 優先 + 個別カラムフォールバックで PII を解決する。
 */
async function resolveResumePii(row: ResumeRow): Promise<ResumePii> {
  if (row.encrypted_pii) {
    const decrypted = await decryptField(row.encrypted_pii);
    if (decrypted) {
      return deserializeResumePii(decrypted);
    }
  }

  // フォールバック:個別カラムから PII を組み立てる。
  // jsonb の education_history / licenses は壊れた値が混ざっていても
  // zod で安全にパースする(従来挙動と同じ)。
  return {
    name: row.name,
    name_kana: row.name_kana,
    birth_date: row.birth_date,
    gender: isGender(row.gender) ? row.gender : null,
    postal_code: row.postal_code,
    address: row.address,
    address_kana: row.address_kana,
    phone: row.phone,
    email: row.email,
    contact_address: row.contact_address,
    contact_address_kana: row.contact_address_kana,
    contact_phone: row.contact_phone,
    photo_url: row.photo_url,
    education_history: parseEducationHistory(row.education_history),
    licenses: parseLicenses(row.licenses),
    motivation_note: row.motivation_note,
    personal_requests: row.personal_requests,
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
 * dual-write のため戻り値は「個別カラム + jsonb の全体」を持つ。
 * 別途 buildEncryptedPii で encrypted_pii を組み立てる。
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
    document_date: emptyToNull(input.document_date),
  };
}

function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * normalizeSaveInput の戻り値から PII だけを抜き出して暗号化する。
 *
 * encryptField は空文字を素通りさせるが、ここでは「PII フィールドが全て
 * null/空配列でも暗号化 JSON を作る」方針(常に encrypted_pii を埋める)。
 * 理由:Step 3b のバックフィル後に「encrypted_pii が NULL なら未移行行」
 * という判定をシンプルに保つため。
 */
async function buildEncryptedPii(
  normalized: ReturnType<typeof normalizeSaveInput>,
): Promise<string> {
  const pii = pickResumePii(normalized);
  const json = serializeResumePii(pii);
  const encrypted = await encryptField(json);
  // encryptField は空文字を素通りさせるが、serializeResumePii は必ず
  // "{...}" を返すので空文字にはならない。型上の保証として絞っておく。
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new Error("encryptField returned non-string for PII payload");
  }
  return encrypted;
}

import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import {
  deserializeResumePii,
  pickResumePii,
  serializeResumePii,
  type ResumePii,
} from "./pii-fields";
import type { Resume, SaveResumeRequest } from "./types";

/**
 * resumes テーブルの CRUD ヘルパー
 *
 * いずれの関数も userId を引数で取り、RLS と独立してアプリ側でも
 * 所有者一致で絞り込む(防御的二重チェック)。
 *
 * 暗号化境界(Step 3c:blob-only):
 *   - 書き込み:encrypted_pii にのみ PII を書く。
 *     旧個別 PII カラム(name / address / phone 等)は Step 3c の
 *     マイグレーションで DROP 済みのため触れない。
 *   - 読み取り:encrypted_pii を復号して PII を組み立てる。
 *     ここを通らないと PII は復元できない(fail-closed)。
 *
 * 下流(フォーム / プレビュー / PDF)に返す Resume の形は Step 3a と完全に同一。
 */

// ============================================
// 読み取り対象カラム(blob-only)
//
// 旧個別 PII カラムは DROP 済み。SELECT * すると将来別カラムが追加されたとき
// 影響範囲が読みにくくなるため、明示的に列挙する。
// ============================================
const SELECT_COLUMNS = "id, user_id, title, document_date, encrypted_pii, created_at, updated_at";

// ============================================
// 一覧取得
// ============================================
export async function listResumes(userId: string): Promise<Resume[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("resumes")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list resumes: ${error.message}`);
  }

  return Promise.all((data ?? []).map(mapResumeRow));
}

// ============================================
// 単一取得
// ============================================
export async function getResume(resumeId: string, userId: string): Promise<Resume | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("resumes")
    .select(SELECT_COLUMNS)
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return mapResumeRow(data);
}

// ============================================
// 新規作成
//
// 平文 PII は DB に渡さない。encrypted_pii に JSON 暗号文だけを書く。
// ============================================
export async function createResume(userId: string, input: SaveResumeRequest): Promise<string> {
  const supabase = await createClient();

  const encryptedPii = await buildEncryptedPii(input);

  const row = {
    user_id: userId,
    title: input.title,
    document_date: emptyToNull(input.document_date),
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
// 履歴書フォームは常に全項目を送る前提なので、blob を毎回作り直す。
// 部分更新には対応しない(下書きセマンティクスは UI 側で吸収する)。
// ============================================
export async function updateResume(
  resumeId: string,
  userId: string,
  input: SaveResumeRequest,
): Promise<void> {
  const supabase = await createClient();

  const encryptedPii = await buildEncryptedPii(input);

  const updates = {
    title: input.title,
    document_date: emptyToNull(input.document_date),
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
  document_date: string | null;
  encrypted_pii: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * DB の行を Resume 型(camelCase)に変換する。
 *
 * blob-only:
 *   - encrypted_pii が NULL/空 → fail-closed で throw する。
 *     旧個別 PII カラムが消えているため、フォールバック先が無い。
 *     ここで握りつぶすと「全フィールド null の履歴書」を黙って返してしまう。
 *   - decrypt 失敗時はそのまま例外を伝播(改竄 / 鍵不一致を確実に検知)。
 *
 * ログには行 ID のみ載せ、PII の生値は決して出さない。
 */
async function mapResumeRow(row: ResumeRow): Promise<Resume> {
  if (!row.encrypted_pii) {
    throw new Error(
      `Resume row ${row.id} has empty encrypted_pii. 旧個別 PII カラムは削除済みのためフォールバックできません。バックフィルが完了しているか確認してください。`,
    );
  }

  const plaintext = await decryptField(row.encrypted_pii);
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error(
      `Resume row ${row.id} の復号結果が文字列ではありません。鍵設定を確認してください。`,
    );
  }

  const pii: ResumePii = deserializeResumePii(plaintext);

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
 * 入力 SaveResumeRequest から PII 部分を抜き出して暗号化し、encrypted_pii 用の
 * "v{n}:base64url" 文字列を返す。
 *
 * 入力が空に近くても必ず "{...}" の JSON を作るため、encryptField の空文字
 * 素通り挙動には引っかからない。型上の保証として絞っておく。
 */
async function buildEncryptedPii(input: SaveResumeRequest): Promise<string> {
  // SaveResumeRequest をそのまま渡せるよう Record<string, unknown> として扱う。
  const pii = pickResumePii(input as unknown as Record<string, unknown>);
  const json = serializeResumePii(pii);
  const encrypted = await encryptField(json);
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new Error("encryptField が PII payload に対して空文字を返しました。");
  }
  return encrypted;
}

function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

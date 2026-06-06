import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { cvBodySchema, type Cv, type CvBody, type SaveCvRequest } from "./types";

/**
 * cvs テーブルの CRUD ヘルパー
 *
 * 暗号化境界:
 *   - 書き込み:body を JSON 化 → AES-256-GCM で暗号化 → encrypted_body に格納
 *   - 読み取り:encrypted_body を復号 → JSON.parse → zod で検証 → CvBody
 *   - ここを通らないと body は復元できない(fail-closed)
 *
 * 所有者ガード:
 *   - RLS で本人のみ通る前提だが、誤った id に対する 403 を早く返すため
 *     verifyCvOwner で明示的に所有者確認する(履歴書と同じ防御パターン)
 *
 * 部分更新は対応しない:
 *   - フォームは常に全項目を送る前提なので、毎回 encrypted_body を作り直す
 *   - 部分更新の「decrypt → 差し替え → re-encrypt」運用は、Phase 4 で AI 下書きを
 *     入れて「field 単位の更新」を作るときに必要になる。現状は不要
 */

// ============================================
// 読み取り対象カラム
//
// SELECT * で行が膨らむのを避け、明示的に列挙する。
// ============================================
const SELECT_COLUMNS =
  "id, user_id, title, document_date, license_resume_id, encrypted_body, created_at, updated_at";

// ============================================
// 一覧取得(更新日の降順)
// ============================================
export async function listCvs(userId: string): Promise<Cv[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("cvs")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list cvs: ${error.message}`);
  }

  return Promise.all((data ?? []).map(mapCvRow));
}

// ============================================
// 単一取得(本人のもののみ)
// ============================================
export async function getCv(cvId: string, userId: string): Promise<Cv | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("cvs")
    .select(SELECT_COLUMNS)
    .eq("id", cvId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return mapCvRow(data);
}

// ============================================
// 新規作成
//
// 平文 body は DB に渡さない。encrypted_body に JSON 暗号文だけを書く。
// ============================================
export async function createCv(userId: string, input: SaveCvRequest): Promise<string> {
  const supabase = await createClient();

  const encryptedBody = await buildEncryptedBody(input.body);

  const row = {
    user_id: userId,
    title: input.title,
    document_date: emptyToNull(input.document_date),
    license_resume_id: input.license_resume_id ?? null,
    encrypted_body: encryptedBody,
  };

  const { data, error } = await supabase.from("cvs").insert(row).select("id").single();

  if (error || !data) {
    throw new Error(`Failed to create cv: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

// ============================================
// 更新(全項目を上書き)
//
// 履歴書と同じく「フォームは常に全項目を送る」前提。
// 部分更新には対応しない(下書きセマンティクスは UI 側で吸収する)。
// ============================================
export async function updateCv(cvId: string, userId: string, input: SaveCvRequest): Promise<void> {
  const supabase = await createClient();

  const encryptedBody = await buildEncryptedBody(input.body);

  const updates = {
    title: input.title,
    document_date: emptyToNull(input.document_date),
    license_resume_id: input.license_resume_id ?? null,
    encrypted_body: encryptedBody,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("cvs").update(updates).eq("id", cvId).eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update cv: ${error.message}`);
  }
}

// ============================================
// 削除(物理削除)
// ============================================
export async function deleteCv(cvId: string, userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("cvs").delete().eq("id", cvId).eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete cv: ${error.message}`);
  }
}

// ============================================
// 所有者確認(RLS とは別の明示的なガード)
//
// 履歴書と同じ防御パターン。RLS だけだと「他人の id を渡されたら 404」になるが、
// API 側で 403 を返したいので明示的に確認する。
// ============================================
export async function verifyCvOwner(cvId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase.from("cvs").select("user_id").eq("id", cvId).maybeSingle();

  return data?.user_id === userId;
}

// ====================================================================
// 内部ヘルパー
// ====================================================================

type CvRow = {
  id: string;
  user_id: string;
  title: string;
  document_date: string | null;
  license_resume_id: string | null;
  encrypted_body: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * DB 行 → Cv 型(camelCase)に変換。encrypted_body を復号して body に詰める。
 *
 * - encrypted_body が空 → fail-closed で throw(NOT NULL なのに空はあり得ない)
 * - decrypt 失敗 → そのまま例外を伝播(改竄/鍵不一致を確実に検知)
 * - JSON / スキーマ不一致 → 例外(壊れたデータを黙って渡さない)
 *
 * ログに body の中身は出さない(機密)。
 */
async function mapCvRow(row: CvRow): Promise<Cv> {
  if (!row.encrypted_body) {
    throw new Error(`Cv row ${row.id} has empty encrypted_body. NOT NULL カラムなので異常です。`);
  }

  const plaintext = await decryptField(row.encrypted_body);
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error(
      `Cv row ${row.id} の復号結果が文字列ではありません。鍵設定を確認してください。`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error(`Cv row ${row.id} の body が JSON として不正です。`);
  }

  const validated = cvBodySchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Cv row ${row.id} の body がスキーマに合いません: ${JSON.stringify(validated.error.issues)}`,
    );
  }

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    documentDate: row.document_date,
    licenseResumeId: row.license_resume_id,
    body: validated.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * CvBody を JSON 化して暗号化し、encrypted_body 用の "v{n}:base64url" を返す。
 *
 * 空の CvBody(emptyCvBody())でも JSON.stringify は "{...}" を返すため、
 * encryptField の空文字素通り挙動には引っかからない。型として絞っておく。
 */
async function buildEncryptedBody(body: CvBody): Promise<string> {
  const json = JSON.stringify(body);
  const encrypted = await encryptField(json);
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new Error("encryptField が CV body に対して空文字を返しました。");
  }
  return encrypted;
}

function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

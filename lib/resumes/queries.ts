import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
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
//
// carryOver.photo_url:
//   既存履歴書を「応募ごとの履歴書」として複製するケースで、写真パスを引き継ぐために使う。
//   通常の新規作成時は省略してよい(updateResume と違って必須ではない)。
//
// sourceResumeId:
//   非 null の 場合 「複製」扱い。 月次 作成 クォータ を 消費しない。
//   サーバ側で 自分の 履歴書 か どうか を 検証する。
//   null の 場合 (新規作成) は seeker_resume_create を 1 回 カウント。
// ============================================
export class ResumeQuotaExceededError extends Error {
  current: number;
  limit: number;
  constructor(current: number, limit: number) {
    super(`Resume creation quota exceeded: ${current} / ${limit}`);
    this.name = "ResumeQuotaExceededError";
    this.current = current;
    this.limit = limit;
  }
}

export async function createResume(
  userId: string,
  input: SaveResumeRequest,
  carryOver?: { photo_url?: string | null },
  sourceResumeId?: string | null,
): Promise<string> {
  const supabase = await createClient();

  // 複製の 場合 source が 自分の 履歴書 か を 確認 (他人の id を 偽装 して
  // クォータ回避 する 抜け道 を 塞ぐ)。
  const isDuplicate = !!sourceResumeId;
  if (isDuplicate) {
    const { data: src } = await supabase
      .from("resumes")
      .select("id")
      .eq("id", sourceResumeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!src) {
      // 自分の もので ない or 存在しない id → 安全側で 新規作成 として 扱う
      // (=クォータ カウント)
    }
  }

  // 新規作成の 場合 のみ クォータ check
  const shouldCountQuota = !isDuplicate;
  if (shouldCountQuota) {
    const usage = await checkAiUsageLimit(supabase, userId, "seeker_resume_create");
    if (!usage.allowed) {
      throw new ResumeQuotaExceededError(usage.current, usage.limit);
    }
  }

  const encryptedPii = await buildEncryptedPii(input, carryOver);

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

  // クォータ消費の 記録 (複製は カウント しない)
  if (shouldCountQuota) {
    await recordAiUsage(supabase, userId, "seeker_resume_create", {
      resume_id: data.id as string,
    });
  }

  return data.id as string;
}

// ============================================
// 更新(全項目を上書き)
//
// 履歴書フォームは常に全項目を送る前提なので、blob を毎回作り直す。
// 部分更新には対応しない(下書きセマンティクスは UI 側で吸収する)。
//
// 例外:photo_url はフォームから送られない(別 API でアップロード)ため、
// 既存値を読み出して維持する。これをやらないとフォーム保存のたびに
// 写真が消える。
// ============================================
export async function updateResume(
  resumeId: string,
  userId: string,
  input: SaveResumeRequest,
): Promise<void> {
  const supabase = await createClient();

  // 写真パスは別 API(/api/resumes/[id]/photo)で管理しているため、
  // フォーム保存時に上書きされないよう既存値を carry-over する。
  const existing = await getResume(resumeId, userId);
  const encryptedPii = await buildEncryptedPii(input, {
    photo_url: existing?.photoUrl ?? null,
  });

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
// 写真パスだけを更新
//
// アップロード/削除 API から呼ぶ。フォーム保存とは独立して、
// encrypted_pii 内の photo_url だけを差し替える。
// 他の PII フィールドは既存値を維持する(decrypt → 差し替え → re-encrypt)。
// ============================================
export async function updateResumePhotoPath(
  resumeId: string,
  userId: string,
  photoPath: string | null,
): Promise<void> {
  const supabase = await createClient();

  const existing = await getResume(resumeId, userId);
  if (!existing) {
    throw new Error(`Resume ${resumeId} not found`);
  }

  // 既存 PII を camelCase の Resume から snake_case の ResumePii に詰め直す。
  // photo_url だけ差し替え、他は維持する。
  const pii: ResumePii = {
    name: existing.name,
    name_kana: existing.nameKana,
    birth_date: existing.birthDate,
    gender: existing.gender,
    postal_code: existing.postalCode,
    address: existing.address,
    address_kana: existing.addressKana,
    phone: existing.phone,
    email: existing.email,
    contact_address: existing.contactAddress,
    contact_address_kana: existing.contactAddressKana,
    contact_phone: existing.contactPhone,
    photo_url: photoPath,
    education_history: existing.educationHistory,
    licenses: existing.licenses,
    motivation_note: existing.motivationNote,
    personal_requests: existing.personalRequests,
  };

  const encrypted = await encryptField(serializeResumePii(pii));
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new Error("encryptField が photo_url 更新 payload に対して空文字を返しました。");
  }

  const { error } = await supabase
    .from("resumes")
    .update({
      encrypted_pii: encrypted,
      updated_at: new Date().toISOString(),
    })
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update photo path: ${error.message}`);
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
 *
 * carryOver:
 *   フォームに含まれないが encrypted_pii に保持したいフィールドを上書きする。
 *   現状は photo_url のみ(別 API でアップロード管理)。
 */
async function buildEncryptedPii(
  input: SaveResumeRequest,
  carryOver?: { photo_url?: string | null },
): Promise<string> {
  // SaveResumeRequest をそのまま渡せるよう Record<string, unknown> として扱う。
  const source: Record<string, unknown> = { ...input };
  if (carryOver?.photo_url !== undefined) {
    source.photo_url = carryOver.photo_url;
  }
  const pii = pickResumePii(source);
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

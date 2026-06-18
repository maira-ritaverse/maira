import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import {
  applicationDetailsSchema,
  type Application,
  type ApplicationDetails,
  type ApplicationStatus,
  type CreateApplicationRequest,
  type UpdateApplicationRequest,
} from "./types";

/**
 * applications テーブルの CRUD ヘルパー
 *
 * 暗号化(2026-06-18):
 *   ・encrypted_details_v2 (text) に AES-256-GCM の "v{n}:base64url" 暗号文を格納。
 *   ・旧 encrypted_details (bytea) は触らない(マイグレーションで NOT NULL 解除済み)。
 *   ・既存データのバックフィルは scripts/backfill-field-encryption.ts で実施。
 *
 * いずれの関数も userId を引数で受け取り、RLS とは別にアプリ側でも
 * 所有者一致を絞り込んで返す(防御的二重チェック)。
 */

/**
 * パースに失敗した details の表示用フォールバック。
 * UI を crash させないため、エラーであることが分かる文字列を返す。
 */
const PARSE_ERROR_DETAILS: ApplicationDetails = {
  company: "(parse error)",
  position: "(parse error)",
};

/**
 * 応募一覧を取得(未アーカイブのみ、updated_at 降順)
 *
 * statusFilter を渡せば特定ステータスだけに絞れる。
 */
export async function listApplications(
  userId: string,
  statusFilter?: ApplicationStatus,
): Promise<Application[]> {
  const supabase = await createClient();

  let query = supabase
    .from("applications")
    .select(
      "id, encrypted_details_v2, status, applied_at, next_action_at, is_archived, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("is_archived", false);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list applications: ${error.message}`);
  }

  // 復号は並列で進める(各レコード独立)
  const rows = (data ?? []) as ApplicationRow[];
  return await Promise.all(rows.map(mapApplicationRow));
}

/**
 * 応募 1 件を取得
 */
export async function getApplication(
  applicationId: string,
  userId: string,
): Promise<Application | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, encrypted_details_v2, status, applied_at, next_action_at, is_archived, created_at, updated_at",
    )
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return await mapApplicationRow(data as ApplicationRow);
}

/**
 * 応募を新規作成
 *
 * 戻り値は作成した application の id。
 */
export async function createApplication(
  userId: string,
  input: CreateApplicationRequest,
): Promise<string> {
  const supabase = await createClient();

  // 平文 JSON を AES-256-GCM で暗号化
  const ciphertext = await encryptField(JSON.stringify(input.details));

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      encrypted_details_v2: ciphertext,
      status: input.status ?? "considering",
      applied_at: input.applied_at ?? null,
      next_action_at: input.next_action_at ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create application: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

/**
 * 応募を更新
 *
 * 渡されたフィールドだけを更新する(部分更新)。
 * details を渡した場合は丸ごと差し替える(マージしない)。
 */
export async function updateApplication(
  applicationId: string,
  userId: string,
  input: UpdateApplicationRequest,
): Promise<void> {
  const supabase = await createClient();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.details) {
    updates.encrypted_details_v2 = await encryptField(JSON.stringify(input.details));
  }

  if (input.status !== undefined) updates.status = input.status;
  if (input.applied_at !== undefined) updates.applied_at = input.applied_at;
  if (input.next_action_at !== undefined) updates.next_action_at = input.next_action_at;
  if (input.is_archived !== undefined) updates.is_archived = input.is_archived;

  const { error } = await supabase
    .from("applications")
    .update(updates)
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update application: ${error.message}`);
  }
}

/**
 * 応募を物理削除
 *
 * 注意: 関連する tasks も DB の ON DELETE CASCADE で同時に削除される。
 */
export async function deleteApplication(applicationId: string, userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete application: ${error.message}`);
  }
}

/**
 * 応募の所有者確認(RLS と独立してアプリ側でも明示的にチェック)
 */
export async function verifyApplicationOwner(
  applicationId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("applications")
    .select("user_id")
    .eq("id", applicationId)
    .maybeSingle();

  return data?.user_id === userId;
}

// ====================================================================
// 内部ヘルパー
// ====================================================================

type ApplicationRow = {
  id: string;
  encrypted_details_v2: string | null;
  status: string;
  applied_at: string | null;
  next_action_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * DB の行を Application 型に変換する。
 *
 * 復号 → JSON.parse → zod 検証。失敗時はフォールバックを返して UI を守る。
 * decryptField は "v{n}:..." 形式の暗号文も、バックフィル前の平文も
 * 同じインタフェースで返してくれる(プレフィックス無しはそのまま返す仕様)。
 */
async function mapApplicationRow(row: ApplicationRow): Promise<Application> {
  let details: ApplicationDetails = PARSE_ERROR_DETAILS;

  const detailsJson = await decryptField(row.encrypted_details_v2);
  if (detailsJson) {
    try {
      const parsed = applicationDetailsSchema.safeParse(JSON.parse(detailsJson));
      if (parsed.success) {
        details = parsed.data;
      }
    } catch {
      // JSON.parse 失敗時はフォールバックのまま
    }
  }

  return {
    id: row.id,
    details,
    status: row.status as ApplicationStatus,
    applied_at: row.applied_at,
    next_action_at: row.next_action_at,
    is_archived: row.is_archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

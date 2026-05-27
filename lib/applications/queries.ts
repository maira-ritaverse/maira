import { createClient } from "@/lib/supabase/server";
import { byteaToText, textToByteaInput } from "@/lib/crypto/bytea";
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
 * 暗号化は未実装(Week 3 で本実装)。
 * 現状は JSON 文字列を bytea のテキスト入力形式(\xHEX)で書き込む。
 * encryption_iv は暗号化前のためダミー(空 bytea)を入れる。
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
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list applications: ${error.message}`);
  }

  return (data ?? []).map(mapApplicationRow);
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
    .select("*")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return mapApplicationRow(data);
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

  // 平文 JSON を bytea のテキスト入力形式で書き込む
  const detailsBytea = textToByteaInput(JSON.stringify(input.details));
  const dummyIv = textToByteaInput("");

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      encrypted_details: detailsBytea,
      encryption_iv: dummyIv,
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
    updates.encrypted_details = textToByteaInput(JSON.stringify(input.details));
    updates.encryption_iv = textToByteaInput("");
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
  encrypted_details: unknown;
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
 * 暗号化されていない現状でも、details は JSON.parse + zod 検証で
 * 想定外データから UI を守る。
 */
function mapApplicationRow(row: ApplicationRow): Application {
  let details: ApplicationDetails = PARSE_ERROR_DETAILS;

  const detailsJson = byteaToText(row.encrypted_details);
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

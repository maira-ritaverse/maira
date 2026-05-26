import { createClient } from "@/lib/supabase/server";
import type { DocumentType } from "./types";

/**
 * 書類作成モジュール用の会話操作ヘルパー
 *
 * conversations テーブルを書類用にも流用する。
 * - module = "document_writer"
 * - metadata jsonb に document_type 等のモジュール固有情報を入れる
 *
 * メッセージの保存自体は lib/career/conversations.ts の saveMessage を
 * 流用する(暗号化未実装の暫定実装が共通のため)。
 */

/**
 * 書類生成用の会話セッションを新規作成
 *
 * metadata に document_type を入れることで、後で一覧表示時に
 * どの書類タイプの会話なのかを判別できるようにする。
 */
export async function createDocumentConversation(params: {
  userId: string;
  documentType: DocumentType;
  jobInfo?: string;
}): Promise<string> {
  const supabase = await createClient();

  const metadata: Record<string, unknown> = {
    document_type: params.documentType,
  };

  if (params.jobInfo) {
    // 求人情報の最初の100文字をメタデータに(一覧表示用のラベル)
    // 平文で保存している点に注意:本文は messages 側に保存され、Week 3 で
    // 暗号化される。プレビューもその際に暗号化対象に含めるか検討する。
    metadata.job_info_preview = params.jobInfo.slice(0, 100);
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: params.userId,
      module: "document_writer",
      metadata,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create document conversation: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

/**
 * 書類会話の所有者+モジュール確認
 *
 * RLS でもガードされるが、明示的に二重チェックする(防御的)。
 */
export async function verifyDocumentConversation(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("conversations")
    .select("user_id, module")
    .eq("id", conversationId)
    .single();

  if (!data) return false;
  if (data.user_id !== userId) return false;
  if (data.module !== "document_writer") return false;

  return true;
}

/**
 * 書類用の会話一覧を取得
 *
 * metadata の document_type を見ることで UI 側で書類タイプ別に
 * フィルタ表示できる。
 */
export async function listDocumentConversations(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, message_count, last_message_at, is_archived, created_at, metadata")
    .eq("user_id", userId)
    .eq("module", "document_writer")
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list document conversations: ${error.message}`);
  }

  return data ?? [];
}

/**
 * 単一の書類会話を取得(所有者+モジュールチェック込み)
 *
 * 見つからない/別ユーザー/別モジュールの場合は null を返す。
 * UI 側で「存在しない or 権限なし」を 404 として扱える。
 */
export async function getDocumentConversation(conversationId: string, userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, module, metadata, created_at, last_message_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .eq("module", "document_writer")
    .single();

  if (error || !data) return null;

  return data;
}

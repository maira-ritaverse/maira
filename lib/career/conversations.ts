import { createClient } from "@/lib/supabase/server";

/**
 * キャリア棚卸し用の会話/メッセージ操作ヘルパー
 *
 * 暗号化は未実装(Week 3で本実装)。
 * 暫定として平文のUTF-8バイト列を bytea カラムに格納する。
 * encryption_iv は暗号化前のためダミー(空 bytea)を入れる。
 */

export type MessageForChat = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * 会話セッションを新規作成
 */
export async function createCareerConversation(userId: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      module: "career_inventory",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create conversation: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

/**
 * 会話の所有者・モジュール一致を確認
 *
 * RLSでもガードされるが、明示的に二重チェックする(防御的)。
 */
export async function verifyConversationOwner(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("user_id, module")
    .eq("id", conversationId)
    .single();

  if (error || !data) return false;
  if (data.user_id !== userId) return false;
  if (data.module !== "career_inventory") return false;

  return true;
}

/**
 * 会話の全メッセージを取得(時系列順)
 */
export async function getMessages(conversationId: string): Promise<MessageForChat[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("messages")
    .select("role, encrypted_content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    role: row.role as MessageForChat["role"],
    content: bytesToText(row.encrypted_content),
  }));
}

/**
 * メッセージを保存
 * 暗号化なし版:UTF-8バイト列を bytea に保存
 */
export async function saveMessage(params: {
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const supabase = await createClient();

  const contentBytes = textToBytes(params.content);
  // 暗号化なし版のダミーIV(本実装で本物のIVに置き換える)
  const dummyIv = textToBytes("");

  const { error: insertError } = await supabase.from("messages").insert({
    conversation_id: params.conversationId,
    user_id: params.userId,
    role: params.role,
    encrypted_content: contentBytes,
    encryption_iv: dummyIv,
    model_used: params.modelUsed,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
  });

  if (insertError) {
    throw new Error(`Failed to save message: ${insertError.message}`);
  }

  // conversations.message_count / last_message_at を更新
  // 並行更新時の整合性のため SQL関数で対応(なければフォールバック)
  const { error: rpcError } = await supabase.rpc("increment_conversation_message_count", {
    conversation_id_param: params.conversationId,
  });

  if (rpcError) {
    // RPC未適用環境向けのフォールバック:直接 update する
    // (message_count は厳密にカウントできないが last_message_at は更新できる)
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", params.conversationId);
  }
}

/**
 * ユーザーのキャリア棚卸し会話一覧を取得(最新更新順)
 */
export async function listCareerConversations(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, message_count, last_message_at, is_archived, created_at")
    .eq("user_id", userId)
    .eq("module", "career_inventory")
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list conversations: ${error.message}`);
  }

  return data ?? [];
}

// ====================================================================
// バイト列とテキストの相互変換(暫定)
// Week 3 で AES-256-GCM の本物の暗号化に置き換える。
// ====================================================================

function textToBytes(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

/**
 * Supabase が返す bytea を文字列に戻す
 *
 * supabase-js は bytea を以下のいずれかの形式で返す可能性がある:
 * 1. "\\x..." プレフィックス付きの16進数文字列(PostgREST デフォルト)
 * 2. Base64 文字列
 * 3. Uint8Array / Buffer
 */
function bytesToText(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex").toString("utf-8");
    }
    return Buffer.from(value, "base64").toString("utf-8");
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf-8");
  }

  // 想定外の形式が来た場合は安全側に倒して空文字
  return "";
}

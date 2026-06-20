/**
 * Advisor チャット の DB ヘルパー
 *
 * 役割:
 *   ・thread の getOrCreate (エージェント / 求職者 両方 から 呼ぶ)
 *   ・メッセージ 投稿 (暗号化 + last_message_at / unread カウンタ 更新)
 *   ・メッセージ 一覧 取得 (復号 して 返す)
 *   ・既読 マーク (unread カウンタ リセット)
 *
 * RLS は SELECT/INSERT/UPDATE すべて user 経由 で 効く 設計 なので、
 * 多く の 関数 は user セッション の supabase client を 引数 で 取る。
 * 復号 は サーバ 側 のみ (ブラウザ に 平文 を 渡さ ない 方針 と は 矛盾 しない
 * — UI が 平文 を 表示 する 必要 が あり、 そこ は API レスポンス で 復号 済 文字列 を 返す)。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { AdvisorMessageView, AdvisorSenderKind, AdvisorThreadView } from "./types";

type ThreadRow = {
  id: string;
  organization_id: string;
  client_record_id: string;
  seeker_user_id: string;
  last_message_at: string | null;
  unread_for_seeker: number;
  unread_for_agency: number;
  created_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_kind: AdvisorSenderKind;
  sender_user_id: string;
  encrypted_content: string;
  read_at: string | null;
  created_at: string;
};

/**
 * client_records_id を キー に thread を 取得 or 新規 作成。
 *
 * 1 client_records に つき 1 thread (UNIQUE(org, client))。
 * 同時 作成 で 競合 した 場合 は 既存 行 を 取得 し直す (upsert ライク)。
 *
 * 呼び出し 側 は エージェント か 求職者 いずれ か (RLS で 自分 の 範囲 のみ insert 可)。
 * 求職者 側 から 作る 場合 は client_records.linked_user_id = auth.uid() で
 * 自分 の thread だけ 作れる よう RLS が 制約 する。
 */
export async function getOrCreateThread(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    clientRecordId: string;
    seekerUserId: string;
  },
): Promise<ThreadRow | null> {
  // まず 既存 行 を 探す
  const existing = await supabase
    .from("advisor_threads")
    .select(
      "id, organization_id, client_record_id, seeker_user_id, last_message_at, unread_for_seeker, unread_for_agency, created_at",
    )
    .eq("organization_id", args.organizationId)
    .eq("client_record_id", args.clientRecordId)
    .maybeSingle();
  if (existing.data) {
    return existing.data as ThreadRow;
  }

  // 無ければ 新規 INSERT
  const inserted = await supabase
    .from("advisor_threads")
    .insert({
      organization_id: args.organizationId,
      client_record_id: args.clientRecordId,
      seeker_user_id: args.seekerUserId,
    })
    .select(
      "id, organization_id, client_record_id, seeker_user_id, last_message_at, unread_for_seeker, unread_for_agency, created_at",
    )
    .maybeSingle();
  if (inserted.data) {
    return inserted.data as ThreadRow;
  }

  // 競合 (同時 作成) — もう 一度 SELECT
  const retry = await supabase
    .from("advisor_threads")
    .select(
      "id, organization_id, client_record_id, seeker_user_id, last_message_at, unread_for_seeker, unread_for_agency, created_at",
    )
    .eq("organization_id", args.organizationId)
    .eq("client_record_id", args.clientRecordId)
    .maybeSingle();
  return (retry.data as ThreadRow | null) ?? null;
}

export function toThreadView(row: ThreadRow): AdvisorThreadView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientRecordId: row.client_record_id,
    seekerUserId: row.seeker_user_id,
    lastMessageAt: row.last_message_at,
    unreadForSeeker: row.unread_for_seeker,
    unreadForAgency: row.unread_for_agency,
    createdAt: row.created_at,
  };
}

/**
 * thread 一覧 (RLS で 視認 範囲 が フィルタ される)。
 *
 * プレビュー (lastMessagePreview) は 最後 1 件 を 復号 して 添える。
 * N+1 を 避ける ため 別 クエリ で 一括 取得 → map で マージ。
 */
export async function listThreads(
  supabase: SupabaseClient,
  options?: { limit?: number },
): Promise<AdvisorThreadView[]> {
  const { data, error } = await supabase
    .from("advisor_threads")
    .select(
      "id, organization_id, client_record_id, seeker_user_id, last_message_at, unread_for_seeker, unread_for_agency, created_at",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(options?.limit ?? 100);
  if (error) {
    console.error("[advisor/queries] listThreads failed", error.message);
    return [];
  }
  const threads = (data ?? []) as ThreadRow[];
  if (threads.length === 0) return [];

  // 最終 メッセージ プレビュー を 復号
  const previews = await loadLastMessagePreviews(
    supabase,
    threads.map((t) => t.id),
  );
  return threads.map((t) => ({
    ...toThreadView(t),
    lastMessagePreview: previews.get(t.id) ?? null,
  }));
}

/**
 * thread_id 一覧 を 受け取り、 thread ごと に 最新 1 件 を 取って 復号 した プレビュー を 返す。
 *
 * シンプル 実装: N 件 の 個別 クエリ。 thread 数 ≤ 100 想定 なので 許容。
 * 後 で 重く なれば Postgres の DISTINCT ON / LATERAL JOIN に 切り替え。
 */
async function loadLastMessagePreviews(
  supabase: SupabaseClient,
  threadIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    threadIds.map(async (id) => {
      const { data } = await supabase
        .from("advisor_messages")
        .select("encrypted_content")
        .eq("thread_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const cipher = (data as { encrypted_content: string } | null)?.encrypted_content;
      if (!cipher) return;
      const plain = await decryptField(cipher);
      if (plain) map.set(id, plain.slice(0, 80));
    }),
  );
  return map;
}

/**
 * thread の メッセージ 一覧 (古い → 新しい 順) を 取得 し、 復号 して 返す。
 */
export async function listMessages(
  supabase: SupabaseClient,
  threadId: string,
  options?: { limit?: number },
): Promise<AdvisorMessageView[]> {
  const { data, error } = await supabase
    .from("advisor_messages")
    .select("id, thread_id, sender_kind, sender_user_id, encrypted_content, read_at, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(options?.limit ?? 200);
  if (error) {
    console.error("[advisor/queries] listMessages failed", error.message);
    return [];
  }
  const rows = (data ?? []) as MessageRow[];
  const decrypted = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      threadId: r.thread_id,
      senderKind: r.sender_kind,
      senderUserId: r.sender_user_id,
      content: (await decryptField(r.encrypted_content)) ?? "",
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
  );
  return decrypted;
}

/**
 * メッセージ を 1 件 投稿。
 *
 * 1) advisor_messages へ INSERT (暗号化 後)
 * 2) advisor_threads.last_message_at と 反対側 unread カウンタ を 更新
 *
 * 通知 fan-out (in_app / メール) は 呼び出し 側 (API ルート) の 責任。
 * service_role を 渡す 必要 は ない (本人 として 投稿 する だけ)。
 */
export async function postMessage(
  supabase: SupabaseClient,
  args: {
    threadId: string;
    senderKind: AdvisorSenderKind;
    senderUserId: string;
    content: string;
  },
): Promise<{ ok: true; messageId: string; createdAt: string } | { ok: false; reason: string }> {
  const cipher = await encryptField(args.content);
  if (!cipher) return { ok: false, reason: "encrypt_failed" };

  const { data: inserted, error: insErr } = await supabase
    .from("advisor_messages")
    .insert({
      thread_id: args.threadId,
      sender_kind: args.senderKind,
      sender_user_id: args.senderUserId,
      encrypted_content: cipher,
    })
    .select("id, created_at")
    .single();
  if (insErr || !inserted) {
    return { ok: false, reason: `db_insert_failed: ${insErr?.message ?? "unknown"}` };
  }
  const row = inserted as { id: string; created_at: string };

  // last_message_at と 反対側 unread を ++。
  // RPC 化 する 余地 は ある が、 thread 1 行 だけ なら 個別 UPDATE で 十分 安全。
  // 反対側 が seeker か agency か で カラム を 切り替え。
  const counterColumn = args.senderKind === "seeker" ? "unread_for_agency" : "unread_for_seeker";
  // 楽観 加算: 現値 を 取って +1 で UPDATE。 衝突 で 過小 計上 は 致命 では ない (バッジ 表示 用)。
  const { data: tRow } = await supabase
    .from("advisor_threads")
    .select(`${counterColumn}`)
    .eq("id", args.threadId)
    .maybeSingle();
  const current = (tRow as Record<string, number> | null)?.[counterColumn] ?? 0;
  await supabase
    .from("advisor_threads")
    .update({
      last_message_at: row.created_at,
      [counterColumn]: current + 1,
    })
    .eq("id", args.threadId);

  return { ok: true, messageId: row.id, createdAt: row.created_at };
}

/**
 * 自分 (senderKind) が 開いた タイミング で 自分側 unread カウンタ を 0 に リセット。
 *
 * 例: 求職者 が chat 画面 を 開いた → unread_for_seeker = 0
 */
export async function markThreadRead(
  supabase: SupabaseClient,
  args: { threadId: string; reader: AdvisorSenderKind },
): Promise<void> {
  const column = args.reader === "seeker" ? "unread_for_seeker" : "unread_for_agency";
  const nowIso = new Date().toISOString();
  // unread カウンタ リセット + read_at 未設定 の 反対側 メッセージ を 既読 化
  await supabase
    .from("advisor_threads")
    .update({ [column]: 0 })
    .eq("id", args.threadId);
  const opposite: AdvisorSenderKind = args.reader === "seeker" ? "agency" : "seeker";
  await supabase
    .from("advisor_messages")
    .update({ read_at: nowIso })
    .eq("thread_id", args.threadId)
    .eq("sender_kind", opposite)
    .is("read_at", null);
}

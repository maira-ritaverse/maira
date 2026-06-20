/**
 * LINE メッセージ 送信 (Reply / Push 自動切替) + DB 保存
 *
 * 設計:
 *   ・直近 30 秒以内 の inbound に reply_token が あれば Reply (無料)
 *   ・無ければ Push (1 通あたり 課金通数 1)
 *   ・送信 結果 を line_messages に INSERT
 *   ・Reply Token は 1 度 使うと 無効化 されるので consumed フラグ で 管理
 *
 * Reply 候補 の 探し方:
 *   ・direction='inbound' / line_user_id 一致 / 同 org
 *   ・reply_token IS NOT NULL
 *   ・reply_token_expires_at > now
 *   ・「まだ Reply 消費 されて いない」… これは ai_usage_events 的に は 別レコード が 無い 状態。
 *     シンプル に reply_token を 「使ったら NULL クリア」する 運用 で 充足。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptField } from "@/lib/crypto/field-encryption";
import { pushMessage, replyMessage, type LineMessage } from "./api";

export type SendMessageResult =
  | {
      ok: true;
      sendMethod: "reply" | "push";
      messageId: string;
      lineMessageIds: string[];
    }
  | {
      ok: false;
      reason: string;
      // 失敗 でも DB には failed 状態 で 保存済み
      messageId?: string;
    };

/**
 * Outbound テキスト メッセージ を 送信。
 *
 * @param service     service_role キー (line_messages INSERT 用)
 * @param organizationId
 * @param lineUserId  送信先 LINE userId
 * @param accessToken Channel Access Token (復号済)
 * @param text        送信本文
 */
export async function sendTextMessage(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
  accessToken: string,
  text: string,
): Promise<SendMessageResult> {
  return await sendMessages(service, organizationId, lineUserId, accessToken, [
    { type: "text", text },
  ]);
}

/**
 * 汎用 送信 (1 回 で 最大 5 通 まで、 LINE 仕様)。
 */
export async function sendMessages(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
  accessToken: string,
  messages: LineMessage[],
): Promise<SendMessageResult> {
  if (messages.length === 0 || messages.length > 5) {
    return { ok: false, reason: "invalid_message_count" };
  }

  // Reply Token 探索
  const replyToken = await findUsableReplyToken(service, organizationId, lineUserId);

  // 結合 用 の DB レコード を 先 に queued で INSERT
  const encryptedContents = await Promise.all(
    messages.map(async (m) => {
      if (m.type === "text") return await encryptField(m.text);
      return await encryptField(JSON.stringify(m));
    }),
  );

  // client_record_id は 1 度 だけ 引いて 全 row に 適用
  const clientRecordId = await getClientRecordIdForLineUser(service, organizationId, lineUserId);

  const insertRows = messages.map((m, i) => ({
    organization_id: organizationId,
    line_user_id: lineUserId,
    direction: "outbound" as const,
    message_type:
      m.type === "sticker"
        ? ("sticker" as const)
        : m.type === "flex"
          ? ("flex" as const)
          : m.type === "image"
            ? ("image" as const)
            : ("text" as const),
    encrypted_content: encryptedContents[i] ?? null,
    sticker_package_id: m.type === "sticker" ? m.packageId : null,
    sticker_id: m.type === "sticker" ? m.stickerId : null,
    send_status: "queued" as const,
    send_method: replyToken ? ("reply" as const) : ("push" as const),
    client_record_id: clientRecordId,
  }));

  const { data: inserted, error: insertErr } = await service
    .from("line_messages")
    .insert(insertRows)
    .select("id");

  if (insertErr || !inserted) {
    return { ok: false, reason: `db_insert_failed: ${insertErr?.message ?? "unknown"}` };
  }

  const insertedIds = (inserted as Array<{ id: string }>).map((r) => r.id);

  // LINE API 送信
  const result = replyToken
    ? await replyMessage(accessToken, replyToken, messages)
    : await pushMessage(accessToken, lineUserId, messages);

  if (!result.ok) {
    // 失敗 状態 で 更新
    await service
      .from("line_messages")
      .update({ send_status: "failed", send_error: result.message })
      .in("id", insertedIds);
    return { ok: false, reason: `line_api_failed: ${result.message}`, messageId: insertedIds[0] };
  }

  // 成功 → reply_token を クリア (= 消費済) + sent 状態 で 更新
  if (replyToken) {
    await service
      .from("line_messages")
      .update({ reply_token: null })
      .eq("organization_id", organizationId)
      .eq("reply_token", replyToken);
  }

  const lineMessageIds = result.data.sentMessages?.map((m) => m.id) ?? [];

  await service.from("line_messages").update({ send_status: "sent" }).in("id", insertedIds);

  return {
    ok: true,
    sendMethod: replyToken ? "reply" : "push",
    messageId: insertedIds[0],
    lineMessageIds,
  };
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 直近 30 秒以内 の inbound メッセージ から 未消費 の reply_token を 1 つ 取得。
 */
async function findUsableReplyToken(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data } = await service
    .from("line_messages")
    .select("reply_token, reply_token_expires_at")
    .eq("organization_id", organizationId)
    .eq("line_user_id", lineUserId)
    .eq("direction", "inbound")
    .not("reply_token", "is", null)
    .gt("reply_token_expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { reply_token: string | null } | null;
  return row?.reply_token ?? null;
}

async function getClientRecordIdForLineUser(
  service: SupabaseClient,
  organizationId: string,
  lineUserId: string,
): Promise<string | null> {
  const { data } = await service
    .from("line_user_links")
    .select("client_record_id")
    .eq("organization_id", organizationId)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  return (data as { client_record_id: string | null } | null)?.client_record_id ?? null;
}

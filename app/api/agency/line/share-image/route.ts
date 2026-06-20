import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { pushMessage, replyMessage, type LineMessage } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/share-image
 *
 * 画像 を Storage に アップロード → 24 時間 署名URL を 発行 → LINE で 送信。
 *
 * 入力 (multipart/form-data):
 *   ・lineUserId: string
 *   ・file: Blob (JPEG / PNG, max 10 MB)
 *
 * 送信後 line_messages.attachment_storage_path を セット (履歴 表示 用)。
 *
 * 注意:
 *   ・LINE は 画像 を 受信後 即時 ダウンロード する ので 24 時間 で 十分
 *   ・preview と original は シンプル化 で 同じ URL を 使う
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const lineUserId = form.get("lineUserId");
  const file = form.get("file");
  if (typeof lineUserId !== "string" || lineUserId.length === 0) {
    return NextResponse.json({ error: "lineUserId required" }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", message: "画像 は 10 MB 以下 に して ください" },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "unsupported_type", message: "JPEG / PNG のみ 対応 して います" },
      { status: 415 },
    );
  }

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // 受信先 が 自組織 の line_user_links か 確認
  const { data: linkRow } = await admin
    .from("line_user_links")
    .select("line_user_id, unfollowed_at")
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const link = linkRow as { line_user_id: string; unfollowed_at: string | null } | null;
  if (!link) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }
  if (link.unfollowed_at) {
    return NextResponse.json({ error: "line_user_unfollowed" }, { status: 409 });
  }

  // Storage 保存
  const ext = file.type === "image/png" ? ".png" : ".jpg";
  const messageUuid = crypto.randomUUID();
  const storagePath = `${guard.organization.id}/${lineUserId}/${messageUuid}${ext}`;

  const { error: uploadErr } = await admin.storage
    .from("line-attachments")
    .upload(storagePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: "upload_failed", message: uploadErr.message },
      { status: 500 },
    );
  }

  // 署名URL (24 時間) を LINE に 渡す
  const { data: signed, error: signErr } = await admin.storage
    .from("line-attachments")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: "signed_url_failed", message: signErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const imageUrl = signed.signedUrl;

  // line_messages に queued で 1 行 INSERT (送信前)
  const { data: insertedRow, error: insErr } = await admin
    .from("line_messages")
    .insert({
      organization_id: guard.organization.id,
      line_user_id: lineUserId,
      direction: "outbound",
      message_type: "image",
      attachment_storage_path: storagePath,
      encrypted_content:
        (await encryptField(JSON.stringify({ type: "image", lineMessageId: messageUuid }))) ?? null,
      send_status: "queued",
      send_method: null,
    })
    .select("id")
    .single();
  if (insErr || !insertedRow) {
    return NextResponse.json(
      { error: "db_insert_failed", message: insErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const insertedId = (insertedRow as { id: string }).id;

  // Reply Token を 探す
  const nowIso = new Date().toISOString();
  const { data: replyRow } = await admin
    .from("line_messages")
    .select("reply_token")
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId)
    .eq("direction", "inbound")
    .not("reply_token", "is", null)
    .gt("reply_token_expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const replyToken = (replyRow as { reply_token: string | null } | null)?.reply_token ?? null;

  const imageMessage: LineMessage = {
    type: "image",
    originalContentUrl: imageUrl,
    previewImageUrl: imageUrl,
  };

  const sendResult = replyToken
    ? await replyMessage(channel.channelAccessToken, replyToken, [imageMessage])
    : await pushMessage(channel.channelAccessToken, lineUserId, [imageMessage]);

  if (!sendResult.ok) {
    await admin
      .from("line_messages")
      .update({ send_status: "failed", send_error: sendResult.message })
      .eq("id", insertedId);
    return NextResponse.json(
      { error: "send_failed", message: sendResult.message, messageId: insertedId },
      { status: 502 },
    );
  }

  if (replyToken) {
    await admin
      .from("line_messages")
      .update({ reply_token: null })
      .eq("organization_id", guard.organization.id)
      .eq("reply_token", replyToken);
  }

  await admin
    .from("line_messages")
    .update({ send_status: "sent", send_method: replyToken ? "reply" : "push" })
    .eq("id", insertedId);

  return NextResponse.json({
    ok: true,
    messageId: insertedId,
    sendMethod: replyToken ? "reply" : "push",
  });
}

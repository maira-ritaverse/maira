/**
 * LINE Webhook イベント の dispatch + DB 反映
 *
 * 役割:
 *   ・message イベント → line_messages に INSERT (text は 暗号化、 画像/音声 等は メタのみ)
 *   ・follow → line_user_links に upsert、 プロファイル を 引いて 保存
 *   ・unfollow → line_user_links.unfollowed_at セット
 *   ・postback → 連携コード 消費 (Chunk 6)
 *
 * 冪等性:
 *   ・line_messages (organization_id, line_message_id) unique
 *   ・on conflict do nothing で 二重INSERT を 防ぐ
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { createZoomMeeting } from "@/lib/integrations/zoom-meeting";
import { getZoomAccessToken } from "@/lib/integrations/zoom-token";
import { getMessageContent, getUserProfile, replyMessage } from "./api";
import type {
  LineMessageEvent,
  LineFollowEvent,
  LinePostbackEvent,
  LineUnfollowEvent,
  LineWebhookEvent,
} from "./events";
import { notifyAgencyOfLineMessage } from "./notifications";
import { applyLinkedRichMenu } from "./rich-menu";

/** Reply Token の 有効期限 (30 秒) */
const REPLY_TOKEN_TTL_MS = 30 * 1000;

type HandlerContext = {
  service: SupabaseClient;
  organizationId: string;
  accessToken: string;
};

export type HandleEventResult = {
  ok: boolean;
  type: string;
  reason?: string;
  /** Chunk 10 で 通知 fan-out 用 に、 保存された メッセージ ID */
  insertedMessageId?: string;
};

export async function handleLineEvent(
  ctx: HandlerContext,
  event: LineWebhookEvent,
): Promise<HandleEventResult> {
  switch (event.type) {
    case "message":
      return await handleMessage(ctx, event);
    case "follow":
      return await handleFollow(ctx, event);
    case "unfollow":
      return await handleUnfollow(ctx, event);
    case "postback":
      return await handlePostback(ctx, event);
    default:
      // 未対応 イベント は 受領 のみ (= 200 で 返す ため OK 扱い)
      return { ok: true, type: event.type, reason: "ignored" };
  }
}

// ============================================================
// message
// ============================================================
/** 連携コード 形式 (issue_line_link_code RPC と 整合) */
const LINK_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

async function handleMessage(
  ctx: HandlerContext,
  event: LineMessageEvent,
): Promise<HandleEventResult> {
  const lineUserId = event.source.userId;
  if (!lineUserId) {
    return { ok: false, type: "message", reason: "no_user_id" };
  }

  const msg = event.message;

  // メッセージ 受信 = 「友達 状態」が 確定 している と 見なし、 line_user_links に
  // 行 が 無ければ 自動作成 (連携前 に 友達追加 して いて follow event を 取り逃がした
  // ケース に 対応)。 プロフィール は LINE API から 取得 し、 失敗 しても 続行。
  await ensureLineUserLink(ctx, lineUserId);

  // inbound 受信 = 「要対応」に 戻す (handled_at を NULL に)
  await ctx.service
    .from("line_user_links")
    .update({ handled_at: null, handled_by_user_id: null })
    .eq("organization_id", ctx.organizationId)
    .eq("line_user_id", lineUserId);

  // text かつ 連携コード パターン に 一致 した 場合、 自動 消費 を 試みる。
  // 成功 すれば 「連携完了」system メッセージ を 残し、 元 の text は 保存しない
  // (機密 = コード 自体 は DB に 残さない)。
  if (msg.type === "text") {
    const trimmed = msg.text.trim().toUpperCase();
    if (LINK_CODE_PATTERN.test(trimmed)) {
      const consumeResult = await tryConsumeLinkCode(ctx, trimmed, lineUserId);
      if (consumeResult.ok) {
        // 連携完了 system メッセージ を 履歴 に 残す
        await ctx.service.from("line_messages").insert({
          organization_id: ctx.organizationId,
          line_user_id: lineUserId,
          direction: "inbound",
          message_type: "system",
          encrypted_content:
            (await encryptField(
              "求職者 が 連携コード を 入力 し、 client_record に 紐付け されました",
            )) ?? null,
          client_record_id: consumeResult.clientRecordId,
        });
        // Rich Menu を 連携済 用 に 切替 (設定 あれば)
        await applyLinkedRichMenu(ctx.service, ctx.organizationId, lineUserId);
        return { ok: true, type: "message", reason: "link_code_consumed" };
      }
      // コード 形式 だが マッチ しなかった (期限切れ / 別 org / 既消費) → 通常 メッセージ として 保存
    }
  }
  let encryptedContent: string | null = null;
  let stickerPackageId: string | null = null;
  let stickerId: string | null = null;
  let attachmentStoragePath: string | null = null;

  switch (msg.type) {
    case "text":
      encryptedContent = (await encryptField(msg.text)) ?? null;
      break;
    case "sticker":
      stickerPackageId = msg.packageId;
      stickerId = msg.stickerId;
      break;
    case "image":
    case "video":
    case "audio":
    case "file":
      // バイナリ を 即時 ダウンロード → Storage 保存 (LINE 側 は 1 週間 で 失効)
      attachmentStoragePath = await downloadAndStoreAttachment(ctx, lineUserId, msg);
      encryptedContent =
        (await encryptField(
          JSON.stringify({
            type: msg.type,
            lineMessageId: msg.id,
            fileName: "fileName" in msg ? msg.fileName : undefined,
            fileSize: "fileSize" in msg ? msg.fileSize : undefined,
          }),
        )) ?? null;
      break;
    case "location":
      encryptedContent =
        (await encryptField(JSON.stringify({ note: `[${msg.type}]`, lineMessageId: msg.id }))) ??
        null;
      break;
  }

  const replyToken = event.replyToken;
  const replyTokenExpiresAt = new Date(event.timestamp + REPLY_TOKEN_TTL_MS).toISOString();

  // 冪等性: 同じ line_message_id を 2 回 受信しても 1 行のみ
  const { data: inserted, error } = await ctx.service
    .from("line_messages")
    .upsert(
      {
        organization_id: ctx.organizationId,
        line_user_id: lineUserId,
        direction: "inbound",
        message_type: msg.type,
        encrypted_content: encryptedContent,
        sticker_package_id: stickerPackageId,
        sticker_id: stickerId,
        attachment_storage_path: attachmentStoragePath,
        line_message_id: msg.id,
        reply_token: replyToken,
        reply_token_expires_at: replyTokenExpiresAt,
        // client_record_id は line_user_links から 別途 link (Chunk 4-extra)
        client_record_id: await getClientRecordIdForLineUser(
          ctx.service,
          ctx.organizationId,
          lineUserId,
        ),
      },
      { onConflict: "organization_id,line_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, type: "message", reason: `insert_failed: ${error.message}` };
  }

  // 通知 fan-out (in-app + Slack + メール)。 失敗は 握り潰す。
  try {
    const { data: linkRow } = await ctx.service
      .from("line_user_links")
      .select("display_name, client_record_id")
      .eq("organization_id", ctx.organizationId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    const link = linkRow as { display_name: string | null; client_record_id: string | null } | null;

    let clientName: string | null = null;
    if (link?.client_record_id) {
      const { data: cr } = await ctx.service
        .from("client_records")
        .select("name")
        .eq("id", link.client_record_id)
        .maybeSingle();
      clientName = (cr as { name?: string } | null)?.name ?? null;
    }

    const preview = buildPreview(msg);
    await notifyAgencyOfLineMessage({
      organizationId: ctx.organizationId,
      lineUserId,
      senderDisplayName: link?.display_name ?? null,
      clientName,
      preview,
      messageType: msg.type,
    });
  } catch (err) {
    console.warn("[line/event-handler] notify failed", err);
  }

  return {
    ok: true,
    type: "message",
    insertedMessageId: (inserted as { id?: string } | null)?.id,
  };
}

/**
 * プレビュー 文字列 を 組み立てる (40 字 目安、 機密 抜粋 を 避ける)。
 */
function buildPreview(msg: LineMessageEvent["message"]): string {
  switch (msg.type) {
    case "text":
      return msg.text.length > 40 ? msg.text.slice(0, 40) + "..." : msg.text;
    case "sticker":
      return "[スタンプ]";
    case "image":
      return "[画像]";
    case "video":
      return "[動画]";
    case "audio":
      return "[音声]";
    case "file":
      return `[ファイル] ${msg.fileName}`;
    case "location":
      return `[位置情報] ${msg.title ?? msg.address ?? ""}`.trim();
    default: {
      const fallback = (msg as { type?: string }).type ?? "unknown";
      return `[${fallback}]`;
    }
  }
}

// ============================================================
// follow (友達追加)
// ============================================================
async function handleFollow(
  ctx: HandlerContext,
  event: LineFollowEvent,
): Promise<HandleEventResult> {
  const lineUserId = event.source.userId;
  if (!lineUserId) {
    return { ok: false, type: "follow", reason: "no_user_id" };
  }

  // LINE API で プロフィール 取得 (失敗 しても 続行)
  const profileResult = await getUserProfile(ctx.accessToken, lineUserId);
  const display = profileResult.ok ? profileResult.data : null;

  const { error } = await ctx.service.from("line_user_links").upsert(
    {
      organization_id: ctx.organizationId,
      line_user_id: lineUserId,
      display_name: display?.displayName ?? null,
      picture_url: display?.pictureUrl ?? null,
      status_message: display?.statusMessage ?? null,
      unfollowed_at: null, // 再 friend back 時 は null に 戻す
    },
    { onConflict: "organization_id,line_user_id" },
  );

  if (error) {
    return { ok: false, type: "follow", reason: `upsert_failed: ${error.message}` };
  }

  // 「友達追加 されました」を 会話履歴 に system メッセージ として 残す
  await ctx.service.from("line_messages").insert({
    organization_id: ctx.organizationId,
    line_user_id: lineUserId,
    direction: "inbound",
    message_type: "system",
    encrypted_content: (await encryptField("友達追加 されました")) ?? null,
  });

  // 自動 歓迎 メッセージ (有効 + 本文 あり の 場合 のみ)
  // Reply Token を 使う ので 課金通数 0。
  try {
    const { data: ch } = await ctx.service
      .from("line_channels")
      .select("welcome_message_enabled, welcome_message_encrypted")
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const channel = ch as {
      welcome_message_enabled: boolean;
      welcome_message_encrypted: string | null;
    } | null;
    if (channel?.welcome_message_enabled && channel.welcome_message_encrypted) {
      const text = await decryptField(channel.welcome_message_encrypted);
      if (text) {
        const replyResult = await replyMessage(ctx.accessToken, event.replyToken, [
          { type: "text", text },
        ]);
        if (replyResult.ok) {
          // 送信 結果 を line_messages に 記録 (outbound)
          await ctx.service.from("line_messages").insert({
            organization_id: ctx.organizationId,
            line_user_id: lineUserId,
            direction: "outbound",
            message_type: "text",
            encrypted_content: channel.welcome_message_encrypted,
            send_status: "sent",
            send_method: "reply",
          });
        } else {
          console.warn("[line/welcome] reply failed", {
            organizationId: ctx.organizationId,
            message: replyResult.message,
          });
        }
      }
    }
  } catch (err) {
    console.warn("[line/welcome] threw", err);
  }

  return { ok: true, type: "follow" };
}

// ============================================================
// postback (Quick Reply / Flex の ボタン タップ)
// ============================================================
async function handlePostback(
  ctx: HandlerContext,
  event: LinePostbackEvent,
): Promise<HandleEventResult> {
  const lineUserId = event.source.userId;
  const data = event.postback.data;
  if (!lineUserId) {
    return { ok: false, type: "postback", reason: "no_user_id" };
  }

  // 「別の日時 を 希望」: line_meeting_other:{proposalId}
  if (data.startsWith("line_meeting_other:")) {
    const proposalId = data.slice("line_meeting_other:".length);
    await ctx.service.from("line_messages").insert({
      organization_id: ctx.organizationId,
      line_user_id: lineUserId,
      direction: "inbound",
      message_type: "system",
      encrypted_content:
        (await encryptField(
          `求職者 が 「別の日時」を 希望 (proposal=${proposalId.slice(0, 8)}...)`,
        )) ?? null,
    });
    await replyMessage(ctx.accessToken, event.replyToken, [
      {
        type: "text",
        text: "承知しました。 別の 候補日 を 改めて 提案 します。",
      },
    ]);
    return { ok: true, type: "postback", reason: "meeting_other" };
  }

  // 候補 確定: line_meeting_proposal:{proposalId}:{slotIndex}
  if (data.startsWith("line_meeting_proposal:")) {
    return await confirmMeetingProposal(ctx, event, lineUserId, data);
  }

  // 求人 興味あり (LINE Flex の 「興味あり」 ボタン タップ)
  if (data.startsWith("job_interest:")) {
    const jobId = data.slice("job_interest:".length);

    // 求人 と 友達 の 情報 を 並列 取得
    const [{ data: jobRow }, { data: linkRow }] = await Promise.all([
      ctx.service
        .from("job_postings")
        .select("id, company_name, position, client_record_id")
        .eq("id", jobId)
        .maybeSingle(),
      ctx.service
        .from("line_user_links")
        .select("display_name, client_record_id")
        .eq("organization_id", ctx.organizationId)
        .eq("line_user_id", lineUserId)
        .maybeSingle(),
    ]);
    const job = jobRow as {
      id: string;
      company_name: string;
      position: string;
      client_record_id: string | null;
    } | null;
    const friend = linkRow as {
      display_name: string | null;
      client_record_id: string | null;
    } | null;

    const seekerName = friend?.display_name ?? "求職者";
    const jobLabel = job ? `${job.position} / ${job.company_name}` : "求人 (取得失敗)";

    // 1) 履歴 に 残す system メッセージ (構造化 内容 で UI が 色付き 表示 でき る)
    const summaryText = `${seekerName} さん が 「${jobLabel}」 に 興味あり`;
    const encryptedContent =
      (await encryptField(
        JSON.stringify({
          kind: "job_interest",
          jobId,
          companyName: job?.company_name ?? null,
          position: job?.position ?? null,
          senderDisplayName: friend?.display_name ?? null,
          text: summaryText,
        }),
      )) ?? null;

    await ctx.service.from("line_messages").insert({
      organization_id: ctx.organizationId,
      line_user_id: lineUserId,
      direction: "inbound",
      message_type: "system",
      encrypted_content: encryptedContent,
      related_job_id: jobId,
      client_record_id: friend?.client_record_id ?? null,
    });

    // 2) 要対応 に 戻す (handled_at = NULL) — 求職者 アクション = 対応 必要
    await ctx.service
      .from("line_user_links")
      .update({ handled_at: null, handled_by_user_id: null })
      .eq("organization_id", ctx.organizationId)
      .eq("line_user_id", lineUserId);

    // 3) 通知 fan-out (in-app + Slack + メール) — 担当 エージェント に 即時通知
    try {
      let clientName: string | null = null;
      if (friend?.client_record_id) {
        const { data: cr } = await ctx.service
          .from("client_records")
          .select("name")
          .eq("id", friend.client_record_id)
          .maybeSingle();
        clientName = (cr as { name?: string } | null)?.name ?? null;
      }
      await notifyAgencyOfLineMessage({
        organizationId: ctx.organizationId,
        lineUserId,
        senderDisplayName: friend?.display_name ?? null,
        clientName,
        preview: `★ 興味あり: ${jobLabel}`,
        messageType: "system",
      });
    } catch (err) {
      console.warn("[line/job_interest] notify failed", err);
    }

    // 4) LINE 側 に Reply で 受領 通知 (求職者 体験)
    await replyMessage(ctx.accessToken, event.replyToken, [
      {
        type: "text",
        text: `「${jobLabel}」 への 興味あり を 受け付けました。 担当 から 改めて ご連絡 します。`,
      },
    ]);
    return { ok: true, type: "postback", reason: "job_interest" };
  }

  // 未知 の postback は ログ だけ 残す
  console.warn("[line/postback] unknown data", { data, lineUserId });
  return { ok: true, type: "postback", reason: "unknown_data" };
}

/**
 * 日程候補 確定 → Zoom 会議 作成 → meeting_schedules INSERT → LINE で 招待 送信。
 *
 * 失敗ケース:
 *   ・期限切れ / 既消費 / 不正 index → 「期限切れ」メッセージ で Reply
 *   ・Zoom 未連携 / Zoom API 失敗 → 「システム エラー」メッセージ で Reply、 ログ
 */
async function confirmMeetingProposal(
  ctx: HandlerContext,
  event: LinePostbackEvent,
  lineUserId: string,
  data: string,
): Promise<HandleEventResult> {
  const parts = data.split(":");
  if (parts.length !== 3) {
    return { ok: false, type: "postback", reason: "invalid_data_format" };
  }
  const proposalId = parts[1];
  const slotIndex = parseInt(parts[2], 10);
  if (!proposalId || Number.isNaN(slotIndex)) {
    return { ok: false, type: "postback", reason: "invalid_data_format" };
  }

  // 提案 を ロック付き で 取得 (二重 確定 防止)
  const { data: proposalRow } = await ctx.service
    .from("line_meeting_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  type ProposalRow = {
    id: string;
    organization_id: string;
    line_user_id: string;
    client_record_id: string | null;
    created_by_user_id: string;
    title: string;
    encrypted_agenda: string | null;
    duration_minutes: number;
    candidates: Array<{ startsAt: string; endsAt: string }>;
    expires_at: string;
    consumed_at: string | null;
    consumed_slot_index: number | null;
    consumed_meeting_schedule_id: string | null;
  };
  const proposal = proposalRow as ProposalRow | null;
  if (!proposal) {
    await replyMessage(ctx.accessToken, event.replyToken, [
      { type: "text", text: "提案 が 見つかりません。 担当 に お問い合わせ ください。" },
    ]);
    return { ok: false, type: "postback", reason: "proposal_not_found" };
  }
  if (proposal.consumed_at !== null) {
    await replyMessage(ctx.accessToken, event.replyToken, [
      { type: "text", text: "この 提案 は 既に 確定 済みです。" },
    ]);
    return { ok: false, type: "postback", reason: "already_consumed" };
  }
  if (new Date(proposal.expires_at).getTime() < Date.now()) {
    await replyMessage(ctx.accessToken, event.replyToken, [
      { type: "text", text: "提案 の 有効期限 が 切れて います。 担当 に お問い合わせ ください。" },
    ]);
    return { ok: false, type: "postback", reason: "expired" };
  }
  if (slotIndex < 0 || slotIndex >= proposal.candidates.length) {
    return { ok: false, type: "postback", reason: "invalid_slot_index" };
  }
  if (proposal.line_user_id !== lineUserId) {
    return { ok: false, type: "postback", reason: "user_mismatch" };
  }

  const slot = proposal.candidates[slotIndex];

  // 議題 を 復号
  const agendaText = proposal.encrypted_agenda
    ? ((await decryptField(proposal.encrypted_agenda)) ?? "")
    : "";

  // Zoom 会議 作成 (発行者 = エージェント 本人 の Zoom 連携)
  let joinUrl: string | null = null;
  let zoomMeetingId: string | null = null;
  let hostUrl: string | null = null;
  let passcode: string | null = null;
  try {
    const zoomCtx = await getZoomAccessToken({
      service: ctx.service,
      byUserId: proposal.created_by_user_id,
    });
    const zoomMeeting = await createZoomMeeting(zoomCtx.accessToken, {
      topic: proposal.title,
      startTime: slot.startsAt,
      durationMinutes: proposal.duration_minutes,
      agenda: agendaText,
    });
    joinUrl = zoomMeeting.join_url;
    zoomMeetingId = String(zoomMeeting.id);
    hostUrl = zoomMeeting.start_url;
    passcode = zoomMeeting.password ?? null;
  } catch (err) {
    console.warn("[line/postback] zoom create failed", err);
    await replyMessage(ctx.accessToken, event.replyToken, [
      {
        type: "text",
        text: "Zoom 会議 の 作成 に 失敗 しました。 担当 から 改めて ご連絡 します。",
      },
    ]);
    return { ok: false, type: "postback", reason: "zoom_create_failed" };
  }

  // meeting_schedules INSERT
  const { data: msRow, error: msErr } = await ctx.service
    .from("meeting_schedules")
    .insert({
      organization_id: ctx.organizationId,
      host_user_id: proposal.created_by_user_id,
      client_record_id: proposal.client_record_id,
      provider: "zoom",
      external_meeting_id: zoomMeetingId,
      join_url: joinUrl,
      host_url: hostUrl,
      passcode,
      title: proposal.title,
      encrypted_agenda: proposal.encrypted_agenda,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      status: "scheduled",
    })
    .select("id")
    .single();

  if (msErr || !msRow) {
    console.warn("[line/postback] meeting_schedules insert failed", msErr);
    await replyMessage(ctx.accessToken, event.replyToken, [
      {
        type: "text",
        text: "予定 の 登録 に 失敗 しました。 担当 から 改めて ご連絡 します。",
      },
    ]);
    return { ok: false, type: "postback", reason: `ms_insert_failed: ${msErr?.message}` };
  }
  const meetingScheduleId = (msRow as { id: string }).id;

  // 提案 を 消費 状態 に
  await ctx.service
    .from("line_meeting_proposals")
    .update({
      consumed_at: new Date().toISOString(),
      consumed_slot_index: slotIndex,
      consumed_meeting_schedule_id: meetingScheduleId,
    })
    .eq("id", proposal.id);

  // LINE に Zoom 招待 を Reply (= 無料)
  const startsAtFormatted = formatJstDateTime(slot.startsAt);
  const replyText = [
    `「${proposal.title}」 を 確定 しました。`,
    ``,
    `日時: ${startsAtFormatted}`,
    `所要時間: ${proposal.duration_minutes} 分`,
    ``,
    `Zoom 参加 URL:`,
    joinUrl,
    passcode ? `パスコード: ${passcode}` : null,
    ``,
    `当日 は こちら から ご参加 ください。`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const replyResult = await replyMessage(ctx.accessToken, event.replyToken, [
    { type: "text", text: replyText },
  ]);

  // 送信 履歴 を 残す (outbound)
  if (replyResult.ok) {
    await ctx.service.from("line_messages").insert({
      organization_id: ctx.organizationId,
      line_user_id: lineUserId,
      direction: "outbound",
      message_type: "text",
      encrypted_content: (await encryptField(replyText)) ?? null,
      send_status: "sent",
      send_method: "reply",
      related_meeting_schedule_id: meetingScheduleId,
      client_record_id: proposal.client_record_id,
    });
  }

  // 確定 system メッセージ も 残す (履歴 で 「決まった」が 見える)
  await ctx.service.from("line_messages").insert({
    organization_id: ctx.organizationId,
    line_user_id: lineUserId,
    direction: "inbound",
    message_type: "system",
    encrypted_content:
      (await encryptField(`求職者 が ${startsAtFormatted} を 確定 しました`)) ?? null,
    related_meeting_schedule_id: meetingScheduleId,
    client_record_id: proposal.client_record_id,
  });

  return { ok: true, type: "postback", reason: "meeting_confirmed" };
}

function formatJstDateTime(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const day = "日月火水木金土"[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} (${day}) ${hh}:${mi}`;
}

// ============================================================
// unfollow (ブロック / 友達解除)
// ============================================================
async function handleUnfollow(
  ctx: HandlerContext,
  event: LineUnfollowEvent,
): Promise<HandleEventResult> {
  const lineUserId = event.source.userId;
  if (!lineUserId) {
    return { ok: false, type: "unfollow", reason: "no_user_id" };
  }

  const now = new Date().toISOString();
  const { error } = await ctx.service
    .from("line_user_links")
    .update({ unfollowed_at: now })
    .eq("organization_id", ctx.organizationId)
    .eq("line_user_id", lineUserId);

  if (error) {
    return { ok: false, type: "unfollow", reason: `update_failed: ${error.message}` };
  }

  // system メッセージ で 履歴 に 残す
  await ctx.service.from("line_messages").insert({
    organization_id: ctx.organizationId,
    line_user_id: lineUserId,
    direction: "inbound",
    message_type: "system",
    encrypted_content: (await encryptField("ブロック / 友達解除 されました")) ?? null,
  });

  return { ok: true, type: "unfollow" };
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * LINE Content API で 添付ファイル を ダウンロード し、 Supabase Storage に 保存。
 *
 * 戻り値: 保存パス (失敗時 は null)。
 *
 * パス: line-attachments/{organization_id}/{line_user_id}/{message_id}.{ext}
 * - organization_id を 先頭に 置く ことで RLS (storage.foldername[1]) が 効く
 * - 拡張子 は content-type から 推測
 *
 * エラー 時は ログ のみ (本処理 = メッセージ INSERT は 続行)。
 */
async function downloadAndStoreAttachment(
  ctx: HandlerContext,
  lineUserId: string,
  msg: { id: string; type: "image" | "video" | "audio" | "file" } & {
    fileName?: string;
  },
): Promise<string | null> {
  try {
    const result = await getMessageContent(ctx.accessToken, msg.id);
    if (!result.ok) {
      console.warn("[line/attachment] download failed", {
        messageId: msg.id,
        status: result.status,
      });
      return null;
    }
    const { contentType, data } = result.data;
    const ext = extensionFor(msg.type, contentType, msg.fileName);
    const storagePath = `${ctx.organizationId}/${lineUserId}/${msg.id}${ext}`;

    const { error: uploadErr } = await ctx.service.storage
      .from("line-attachments")
      .upload(storagePath, data, {
        contentType,
        upsert: true, // 同じ messageId は 同じ ファイル なので 上書き 安全
      });
    if (uploadErr) {
      console.warn("[line/attachment] upload failed", {
        messageId: msg.id,
        message: uploadErr.message,
      });
      return null;
    }
    return storagePath;
  } catch (err) {
    console.warn("[line/attachment] threw", err);
    return null;
  }
}

function extensionFor(
  type: "image" | "video" | "audio" | "file",
  contentType: string,
  fileName?: string,
): string {
  // file は 元 ファイル名 の 拡張子 を 優先
  if (type === "file" && fileName && fileName.includes(".")) {
    const ext = fileName.split(".").pop()!.toLowerCase();
    return `.${ext}`;
  }
  // content-type から 拡張子 推測
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/x-m4a": ".m4a",
    "application/pdf": ".pdf",
  };
  return map[ct] ?? "";
}

/**
 * line_user_links に 行 が 無ければ 作成、 既存 でも プロフィール 未取得 なら 更新。
 *
 * 連携前 友達 / follow 取り逃がし + バックフィル ダミー 名前 を 自動 リカバリ。
 * - 行 が ない → 作成 + LINE API で プロフィール 取得
 * - 行 が ある が display_name が NULL / プレースホルダ → プロフィール 更新
 * - 行 が ある + 正常 → no-op (余分な API call を 避ける)
 */
const PLACEHOLDER_NAMES = new Set(["(連携前 友達)", "(連携前友達)", "(名前なし)"]);

async function ensureLineUserLink(ctx: HandlerContext, lineUserId: string): Promise<void> {
  try {
    const { data: existing } = await ctx.service
      .from("line_user_links")
      .select("id, display_name, picture_url")
      .eq("organization_id", ctx.organizationId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    const row = existing as {
      id: string;
      display_name: string | null;
      picture_url: string | null;
    } | null;

    // 正常 = display_name が ある + プレースホルダ で ない
    const isHealthy =
      row !== null && row.display_name !== null && !PLACEHOLDER_NAMES.has(row.display_name);
    if (isHealthy) return;

    const profileResult = await getUserProfile(ctx.accessToken, lineUserId);
    const display = profileResult.ok ? profileResult.data : null;

    await ctx.service.from("line_user_links").upsert(
      {
        organization_id: ctx.organizationId,
        line_user_id: lineUserId,
        display_name: display?.displayName ?? row?.display_name ?? null,
        picture_url: display?.pictureUrl ?? row?.picture_url ?? null,
        status_message: display?.statusMessage ?? null,
      },
      { onConflict: "organization_id,line_user_id" },
    );
  } catch (err) {
    console.warn("[line/ensure-link] failed", err);
  }
}

/**
 * line_user_links から 紐付いた client_record_id を 引く (未紐付け なら null)。
 */
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

/**
 * 求職者 が LINE で 送信した 連携コード を 消費 し、 line_user_id を client_record に 紐付ける。
 * RPC consume_line_link_code は service_role 限定 で 動作。
 *
 * 成功時 は client_record_id を 返す。 失敗時 (期限切れ / 別 org 等) は ok: false。
 */
async function tryConsumeLinkCode(
  ctx: HandlerContext,
  code: string,
  lineUserId: string,
): Promise<{ ok: true; clientRecordId: string } | { ok: false; reason: string }> {
  const { data, error } = await ctx.service.rpc("consume_line_link_code", {
    p_code: code,
    p_line_user_id: lineUserId,
    p_organization_id: ctx.organizationId,
  });
  if (error) {
    return { ok: false, reason: error.message };
  }
  const clientRecordId = data as string | null;
  if (!clientRecordId) {
    return { ok: false, reason: "no_client_record_id_returned" };
  }
  return { ok: true, clientRecordId };
}

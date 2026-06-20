import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import type { LineMessage } from "@/lib/line/api";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { sendMessages } from "@/lib/line/messaging";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/messages
 *
 * LINE 経由 で 求職者 に メッセージ を 送信。
 * Reply Token が 直近 30 秒以内 に あれば Reply (無料)、 無ければ Push (課金)。
 *
 * admin / advisor とも 送信 可能 (チームで 担当 を 分けて 対応する 想定)。
 *
 * 入力 (排他):
 *   { lineUserId, text }                                — テキスト
 *   { lineUserId, sticker: { packageId, stickerId } }   — スタンプ
 *
 * Phase 2 で Flex / Quick Reply を 追加 予定。
 */
const bodySchema = z.union([
  z.object({
    lineUserId: z.string().min(1).max(64),
    text: z.string().min(1).max(5000),
  }),
  z.object({
    lineUserId: z.string().min(1).max(64),
    sticker: z.object({
      packageId: z.string().min(1).max(20),
      stickerId: z.string().min(1).max(20),
    }),
  }),
]);

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { lineUserId } = parsed.data;

  const admin = createServiceClient();
  const channel = await getLineChannelByOrgId(admin, guard.organization.id);
  if (!channel) {
    return NextResponse.json({ error: "channel_not_configured" }, { status: 409 });
  }

  // 送信先 が 同 org の line_user_links に 存在 する か 確認
  // (手動入力 や 旧 友達 で 解除済 を 弾く)
  const { data: linkRow } = await admin
    .from("line_user_links")
    .select("line_user_id, unfollowed_at")
    .eq("organization_id", guard.organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const link = linkRow as { line_user_id: string; unfollowed_at: string | null } | null;
  if (!link) {
    return NextResponse.json(
      { error: "line_user_not_found", message: "LINE 友達 として 認識 されて いません" },
      { status: 404 },
    );
  }
  if (link.unfollowed_at) {
    return NextResponse.json(
      {
        error: "line_user_unfollowed",
        message: "この LINE ユーザー は ブロック / 友達解除 して います",
      },
      { status: 409 },
    );
  }

  // text / sticker の どちらか の メッセージ を 組み立て
  const messages: LineMessage[] =
    "text" in parsed.data
      ? [{ type: "text", text: parsed.data.text }]
      : [
          {
            type: "sticker",
            packageId: parsed.data.sticker.packageId,
            stickerId: parsed.data.sticker.stickerId,
          },
        ];

  const result = await sendMessages(
    admin,
    guard.organization.id,
    lineUserId,
    channel.channelAccessToken,
    messages,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: "send_failed", message: result.reason, messageId: result.messageId },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    sendMethod: result.sendMethod, // 'reply' or 'push'
    lineMessageIds: result.lineMessageIds,
  });
}

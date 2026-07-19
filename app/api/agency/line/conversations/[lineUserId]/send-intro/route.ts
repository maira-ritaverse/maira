import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { decryptField } from "@/lib/crypto/field-encryption";
import { markConversationHandled, sendMessages } from "@/lib/line/messaging";
import { getLineChannelByOrgId } from "@/lib/line/queries";
import { resolveAvatarPublicUrl } from "@/lib/profile/avatar";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/line/conversations/[lineUserId]/send-intro
 *
 * 呼び出し 側 (advisor / admin) 本人 の LINE 自己 紹介 を、 指定 の 顧客 に 送信 する。
 *
 * 挙動:
 *   ・organization_members.line_intro_* を 引く
 *   ・未 登録 (headline も body も 未 セット) なら 400 で 弾く
 *   ・画像 が あれば → image メッセージ、 続けて text メッセージ (見出し + 本文)
 *   ・画像 なし → text 1 通 だけ
 *   ・sendMessages で reply / push を 自動 判定
 *
 * 認可: requireOrgMember。 自分 の line_intro_* だけ を 送信。
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lineUserId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase, organization } = guard;

  const { lineUserId: raw } = await context.params;
  const lineUserId = decodeURIComponent(raw);

  // 相手 が 自組織 の LINE 友達 か 確認
  const { data: linkRow } = await supabase
    .from("line_user_links")
    .select("line_user_id, unfollowed_at")
    .eq("organization_id", organization.id)
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (!linkRow) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }
  if ((linkRow as { unfollowed_at: string | null }).unfollowed_at) {
    return NextResponse.json(
      { error: "user_unfollowed", message: "ブロック / 友達解除 されて います。" },
      { status: 409 },
    );
  }

  // 自分 の line_intro を 取得
  const { data: memberRow } = await supabase
    .from("organization_members")
    .select("line_intro_headline, encrypted_line_intro_body, line_intro_photo_storage_path")
    .eq("user_id", user.id)
    .eq("organization_id", organization.id)
    // soft delete された メンバー は 自己 紹介 送信 不可
    .is("removed_at", null)
    .maybeSingle();
  const intro = memberRow as {
    line_intro_headline: string | null;
    encrypted_line_intro_body: string | null;
    line_intro_photo_storage_path: string | null;
  } | null;

  const headline = intro?.line_intro_headline?.trim() ?? "";
  // 復号 失敗 (旧 バージョン 鍵 が env から 消えた 等) で 500 に なる の を 防ぐ。
  // 本文 が 壊れて い ても headline / photo で 送信 は 継続 する。
  let bodyRaw = "";
  if (intro?.encrypted_line_intro_body) {
    try {
      bodyRaw = (await decryptField(intro.encrypted_line_intro_body)) ?? "";
    } catch (e) {
      console.warn(
        `[send-intro] body decrypt failed for user ${user.id}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }
  const photoPath = intro?.line_intro_photo_storage_path ?? null;

  if (!headline && !bodyRaw && !photoPath) {
    return NextResponse.json(
      {
        error: "intro_not_set",
        message:
          "自己紹介がまだ登録されていません。 /agency/settings/line-intro で登録してください。",
      },
      { status: 400 },
    );
  }

  // 画像 の 公開 URL を 取得 (avatar-images バケット は publicRead)
  const supabaseAny = await createClient();
  const photoUrl = resolveAvatarPublicUrl(supabaseAny, photoPath);

  // LINE チャンネル + アクセス トークン (service で decrypt する)
  const service = createServiceClient();
  const channel = await getLineChannelByOrgId(service, organization.id);
  if (!channel) {
    return NextResponse.json(
      { error: "line_not_configured", message: "LINE 公式アカウントが 未 連携 です。" },
      { status: 503 },
    );
  }

  // メッセージ を 組み立て
  const textParts: string[] = [];
  if (headline) textParts.push(headline);
  if (bodyRaw) textParts.push(bodyRaw);
  const combinedText = textParts.join("\n\n");

  const messages: Array<
    | { type: "image"; originalContentUrl: string; previewImageUrl: string }
    | { type: "text"; text: string }
  > = [];
  if (photoUrl) {
    messages.push({
      type: "image",
      originalContentUrl: photoUrl,
      previewImageUrl: photoUrl,
    });
  }
  if (combinedText) {
    messages.push({ type: "text", text: combinedText });
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "empty_intro" }, { status: 400 });
  }

  const result = await sendMessages(
    service,
    organization.id,
    lineUserId,
    channel.channelAccessToken,
    messages,
  );
  if (!result.ok) {
    // 他 の LINE 送信 API と 揃えて message で 原因 を UI に 渡す。
    const reason = "reason" in result ? result.reason : "unknown";
    return NextResponse.json({ error: "send_failed", message: reason, reason }, { status: 502 });
  }

  // 送信 成功 = 対応 済み マーク。 他 の share-image / share-job / share-meeting と
  // 同じ 挙動 で、 「要対応」 バッジ を 落とす。
  await markConversationHandled(service, organization.id, lineUserId, user.id);

  return NextResponse.json({ ok: true, sendMethod: result.sendMethod });
}

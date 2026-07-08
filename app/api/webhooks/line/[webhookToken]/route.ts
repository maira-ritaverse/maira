import { NextResponse } from "next/server";

import { handleLineEvent } from "@/lib/line/event-handler";
import type { LineWebhookBody } from "@/lib/line/events";
import { getLineChannelByWebhookToken } from "@/lib/line/queries";
import { verifyLineSignature } from "@/lib/line/signature";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/webhooks/line/[webhookToken]
 *
 * LINE Platform からの webhook 受信エンドポイント。
 *
 * 重要 仕様:
 *   ・LINE は 10 秒以内 の 200 応答 を 期待。 遅延すると 再送 されたり 設定が 無効化 される
 *   ・X-Line-Signature ヘッダ で HMAC-SHA256 署名検証 必須
 *   ・body は raw text で 取得 してから JSON.parse (署名検証 用)
 *   ・冪等性:webhookEventId / message.id で 同一 イベント を 2 度処理 しない
 *   ・「Webhook URL の 検証」(LINE コンソール「検証」ボタン) で events=[] が 来る
 *
 * Phase 3 の 役割:
 *   ・署名 検証
 *   ・event を 種別 ごと に dispatch (Chunk 4 で 中身 実装)
 *
 * Chunk 4 で:
 *   ・message 保存 (encrypted_content)
 *   ・follow / unfollow → line_user_links 更新
 *   ・postback → 連携コード 消費 / 日程確定 等
 *   ・通知 fan-out (Chunk 10)
 */
type RouteContext = { params: Promise<{ webhookToken: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { webhookToken } = await context.params;

  // 1) 生 body を 取得 (署名検証用)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "body_read_failed" }, { status: 400 });
  }

  // 2) webhookToken から Channel を 引く (Token 復号 含む)
  const admin = createServiceClient();
  const lookup = await getLineChannelByWebhookToken(admin, webhookToken);

  if (lookup.kind !== "found") {
    // C1-2 修正: 従来 は inactive と 未 存在 を 同じ 401 で 返し ログ も 出て い
    // なかった ため、 「LINE 側 で 送信 して いる のに Maira 側 で 通知 が 来ない」
    // 事象 の 一次 切り 分け が でき なかった。 状態 別 に 分岐 して 詳細 ログ を 残す。
    if (lookup.kind === "inactive") {
      console.warn("[line/webhook] rejected: channel_inactive", {
        organizationId: lookup.organizationId,
        tokenPrefix: webhookToken.slice(0, 8),
      });
      return NextResponse.json(
        { error: "channel_inactive", message: "Channel is not active" },
        { status: 401 },
      );
    }
    if (lookup.kind === "decrypt_failed") {
      // 暗号化 鍵 の ローテーション ミス 等。 監視 が 必要 な 状態 な の で 目立つ ように 残す。
      console.error("[line/webhook] rejected: token_decrypt_failed", {
        organizationId: lookup.organizationId,
        tokenPrefix: webhookToken.slice(0, 8),
      });
      return NextResponse.json({ error: "channel_config_error" }, { status: 500 });
    }
    console.warn("[line/webhook] rejected: channel_not_found", {
      tokenPrefix: webhookToken.slice(0, 8),
    });
    return NextResponse.json({ error: "channel_not_found" }, { status: 401 });
  }

  const channel = lookup.channel;

  // 3) 署名 検証
  const signature = request.headers.get("x-line-signature");
  if (!verifyLineSignature(rawBody, signature, channel.channelSecret)) {
    // 攻撃 / 設定ミス。 ログ に 残して 401。
    console.warn("[line/webhook] invalid signature", {
      organizationId: channel.organizationId,
      hasSignature: signature !== null,
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // 4) JSON parse
  let parsedBody: LineWebhookBody;
  try {
    parsedBody = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 5) 「Webhook URL 検証」(events=[]) は 即時 200
  if (!parsedBody.events || parsedBody.events.length === 0) {
    return NextResponse.json({ ok: true, message: "verified" });
  }

  // 6) 各 event を 順次 dispatch。 エラーは 個別 に 握り潰す
  //    (1 件 失敗 で 後続 event を 落とさない)。
  const results = await Promise.all(
    parsedBody.events.map(async (event) => {
      try {
        return await handleLineEvent(
          {
            service: admin,
            organizationId: channel.organizationId,
            accessToken: channel.channelAccessToken,
          },
          event,
        );
      } catch (err) {
        return {
          ok: false,
          type: event.type,
          reason: err instanceof Error ? err.message : "unknown",
        };
      }
    }),
  );

  const failedCount = results.filter((r) => !r.ok).length;
  if (failedCount > 0) {
    console.warn("[line/webhook] some events failed", {
      organizationId: channel.organizationId,
      failedCount,
      results,
    });
  }

  // 7) LINE には 必ず 200 (event 処理 失敗 でも、 webhook 自体は 受領)
  return NextResponse.json({ ok: true, processed: results.length, failed: failedCount });
}

/**
 * LINE は 「Webhook URL 検証」で GET を 投げる ことは ない が、
 * もし テスト で GET された 場合 用 に 200 を 返す。
 */
export async function GET() {
  return NextResponse.json({ ok: true, message: "LINE webhook endpoint" });
}

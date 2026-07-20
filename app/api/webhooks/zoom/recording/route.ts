import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { enqueueZoomRecording } from "@/lib/integrations/zoom-ingest";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/webhooks/zoom/recording
 *
 * Zoom Cloud Recording 関連イベント(recording.completed 等)の受信エンドポイント。
 *
 * 認証:
 *   1) Zoom の URL Validation Challenge(endpoint.url_validation)に応答
 *   2) 通常イベントは X-Zm-Signature を ZOOM_WEBHOOK_SECRET で HMAC 検証
 *
 * 実装方針(Step 4 段階):
 *   ・本ハンドラは「受信 → 認証 → ログ」までを担当
 *   ・録画 URL からファイルを引っ張ってきて career_intake_recordings に流す処理は
 *     後続のキュー化(Background Job)と一緒に組む(Step 5)
 *   ・現時点で webhook は受信さえできれば Zoom Marketplace の検証は通る
 */
type ZoomChallenge = {
  event: "endpoint.url_validation";
  payload: { plainToken: string };
};

type ZoomEvent = {
  event: string;
  event_ts?: number;
  payload?: {
    account_id?: string;
    object?: {
      uuid?: string;
      id?: string;
      host_id?: string;
      recording_files?: Array<{
        id: string;
        download_url: string;
        file_type: string;
        recording_type?: string;
      }>;
    };
  };
  download_token?: string;
};

function verifyZoomSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !timestampHeader) return false;
  // v0:{ts}:{body}
  const message = `v0:${timestampHeader}:${rawBody}`;
  const expected = "v0=" + createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const raw = await request.text();
  let body: ZoomChallenge | ZoomEvent;
  try {
    body = JSON.parse(raw) as ZoomChallenge | ZoomEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // ── 1) URL Validation Challenge ──────────────────────────────────
  //     Zoom は 「plainToken を HMAC-SHA256(secret) で 署名 して 返せ」 と 要求 する。
  //     ここで plainToken の 形状 を 制限 しない と、 攻撃者 が plainToken を
  //     「v0:{ts}:{偽装 payload}」 の 形 で 投げ、 我々 の endpoint に 「本物 の
  //     x-zm-signature 相当」 の HMAC 値 を 計算 させる signing oracle に なる。
  //     Zoom 公式 の plainToken は 「10〜64 文字 の 英数 + `-`/`_`」 (URL-safe
  //     base64 相当)。 これ 以外 は 弾く。 マッチ しない plainToken は 過去 に
  //     Zoom 側 から 発行 された 記録 なし → 現実 の challenge は 影響 なし。
  if (body.event === "endpoint.url_validation") {
    const challenge = body as ZoomChallenge;
    const plainToken = challenge.payload.plainToken;
    if (
      typeof plainToken !== "string" ||
      plainToken.length < 10 ||
      plainToken.length > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(plainToken)
    ) {
      return NextResponse.json({ error: "invalid_plain_token" }, { status: 400 });
    }
    const encryptedToken = createHmac("sha256", secret).update(plainToken).digest("hex");
    return NextResponse.json({
      plainToken,
      encryptedToken,
      // 旧仕様の互換のため hash も返す
      hash: createHash("sha256").update(plainToken).digest("hex"),
    });
  }

  // ── 2) 通常イベント:署名検証 ─────────────────────────────────
  if (
    !verifyZoomSignature(
      raw,
      request.headers.get("x-zm-signature"),
      request.headers.get("x-zm-request-timestamp"),
      secret,
    )
  ) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  // ── 3) recording.completed:行作成までを行う(ダウンロード+処理は pickup)
  const event = body as ZoomEvent;
  if (event.event === "recording.completed" && event.payload) {
    const service = createServiceClient();
    const result = await enqueueZoomRecording({
      service,
      payload: event.payload,
    });
    return NextResponse.json({ ok: true, ...result });
  }
  return NextResponse.json({ ok: true, ignored: event.event });
}

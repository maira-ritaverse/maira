/**
 * LINE Webhook 署名 検証 (HMAC-SHA256)
 *
 * 仕様:
 *   - LINE は X-Line-Signature ヘッダ で 「HMAC-SHA256(body, channelSecret) を base64」を 送る
 *   - timingSafeEqual で 比較 (timing attack 防止)
 *
 * 注意:
 *   - body は 「生 リクエストボディ 文字列」(JSON.parse 前) を 渡す こと
 *   - Next.js の Request.text() で 取得し、 その後 JSON.parse する
 */
import { createHmac, timingSafeEqual } from "crypto";

export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false;
  try {
    const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

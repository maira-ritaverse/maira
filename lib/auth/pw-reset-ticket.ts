/**
 * パスワード リセット セッション 専用 チケット。
 *
 * 目的:
 *   `updatePassword` server action は 元 々 「セッション が あれば 現 パスワード なし で
 *   変更 できる」 挙動 で、 攻撃者 が セッション を 一時 掴んだ 状態 で /reset-password
 *   に 直行 → パスワード 差 し 替え → 恒久 乗っ取り が 可能 だった (監査 H1)。
 *
 * 修正 方針:
 *   `/auth/confirm` で `type='recovery'` を 検証 成功 した 直後 に 短命 (10 分)、
 *   httpOnly、 SameSite=Lax、 Secure な 署名 付き cookie を セット。
 *   `updatePassword` は この cookie を 必須 化 して、 使い 切り (削除) する。
 *
 * 値 形式: base64url(iv=userId, exp=unix秒, sig=HMAC-SHA256(userId+exp))
 *   ・秘匿 の 目的 は 無い の で 平文 に 近い が、 signature で 改ざん を 防ぐ
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "pw_reset_ticket";
const TTL_SECONDS = 10 * 60; // 10 分

function getSecret(): string {
  // recovery 用 の 短命 チケット 署名 に FIELD_ENCRYPTION_KEYS を 流用 は 避け、
  // 専用 の env を 使う。 未 設定 なら SUPABASE_JWT_SECRET を fallback で 使用。
  const dedicated = process.env.PW_RESET_TICKET_SECRET;
  if (dedicated && dedicated.length >= 32) return dedicated;
  const jwt = process.env.SUPABASE_JWT_SECRET;
  if (jwt && jwt.length >= 32) return jwt;
  throw new Error("PW_RESET_TICKET_SECRET / SUPABASE_JWT_SECRET 未設定");
}

function sign(userId: string, exp: number): string {
  return createHmac("sha256", getSecret()).update(`${userId}.${exp}`).digest("hex");
}

/** チケット 発行。 cookie に セット する 値 と 属性 を 返す。 */
export function issuePwResetTicket(userId: string): {
  name: string;
  value: string;
  maxAge: number;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
} {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const sig = sign(userId, exp);
  const value = `${userId}.${exp}.${sig}`;
  return {
    name: COOKIE_NAME,
    value,
    maxAge: TTL_SECONDS,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

/** チケット 検証。 ok なら 本人 の user_id、 それ以外 は false。 */
export function verifyPwResetTicket(raw: string | undefined | null, userId: string): boolean {
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [ticketUserId, expStr, sigHex] = parts;
  if (ticketUserId !== userId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(ticketUserId, exp);
  try {
    const a = Buffer.from(sigHex, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const PW_RESET_TICKET_COOKIE = COOKIE_NAME;

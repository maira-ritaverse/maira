/**
 * OAuth state パラメータ(CSRF 対策)の生成 / 検証
 *
 * 仕組み:
 *   payload(user_id, provider, ts) を base64url で詰めて、env の
 *   OAUTH_STATE_SECRET で HMAC-SHA256 をかけて末尾に連結する。
 *
 *   state = base64url(payload) + "." + base64url(hmac)
 *
 *   コールバック側でこれを再計算して timingSafeEqual で照合する。
 *   ttl(既定 10 分)を超えていたら拒否。
 *
 * 注意:
 *   トークンに user_id を入れてあるので、コールバックでログイン済ユーザと
 *   一致するかを必ず確認すること(セッションすり替えの安全網)。
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60 * 1000; // 10 分

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSecret(): string {
  const s = process.env.OAUTH_STATE_SECRET;
  if (!s || s.length < 16) {
    // dev で未設定の場合のフォールバック。本番は env 必須にする(setup doc に明記)。
    return "maira-oauth-state-dev-fallback-do-not-use-in-prod";
  }
  return s;
}

export type OAuthStatePayload = {
  uid: string;
  provider: "zoom" | "google";
  nonce: string;
  iat: number;
};

export function createOAuthState(uid: string, provider: "zoom" | "google"): string {
  const payload: OAuthStatePayload = {
    uid,
    provider,
    nonce: randomBytes(16).toString("hex"),
    iat: Date.now(),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export type VerifiedState =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyOAuthState(state: string, now: number = Date.now()): VerifiedState {
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const expected = b64url(createHmac("sha256", getSecret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8")) as OAuthStatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.iat !== "number" || now - payload.iat > TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

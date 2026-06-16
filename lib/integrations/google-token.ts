/**
 * Google OAuth トークンの取得 + 自動 refresh ヘルパ
 *
 * Zoom と同じパターン:期限内ならそのまま、近接 / 切れていたら refresh して
 * 新トークンを暗号化保存 → 返却。
 *
 * 注意:Google の refresh_token は長期(失効しないか手動 revoke で消える)。
 * access_token は ~ 1 時間。
 */
import { createHmac } from "node:crypto";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { createServiceClient } from "@/lib/supabase/service";

import { getGoogleConfig } from "./google";

type Service = ReturnType<typeof createServiceClient>;

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleAccessContext = {
  userId: string;
  googleEmail: string | null;
  accessToken: string;
};

function isExpired(tokenExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!tokenExpiresAt) return true;
  const ms = new Date(tokenExpiresAt).getTime();
  if (Number.isNaN(ms)) return true;
  return ms - now.getTime() < 60_000;
}

export async function getGoogleAccessToken(args: {
  service: Service;
  userId: string;
}): Promise<GoogleAccessContext> {
  const { service, userId } = args;
  const { data, error } = await service
    .from("google_connections")
    .select(
      "user_id, google_email, encrypted_access_token, encrypted_refresh_token, token_expires_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    throw new Error("google_connections 未登録");
  }
  const row = data as {
    user_id: string;
    google_email: string | null;
    encrypted_access_token: string;
    encrypted_refresh_token: string;
    token_expires_at: string | null;
  };

  if (!isExpired(row.token_expires_at)) {
    const t = await decryptField(row.encrypted_access_token);
    if (t) return { userId: row.user_id, googleEmail: row.google_email, accessToken: t };
  }

  // refresh
  const config = getGoogleConfig();
  if (!config) throw new Error("Google 設定が未登録のため refresh できません");
  const refreshToken = await decryptField(row.encrypted_refresh_token);
  if (!refreshToken) throw new Error("refresh_token の復号に失敗");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google refresh failed: ${res.status} ${await res.text()}`);
  }
  const fresh = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  const enc = await encryptField(fresh.access_token);
  if (!enc) throw new Error("新 access_token の暗号化失敗");
  const expiresAt = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
  await service
    .from("google_connections")
    .update({
      encrypted_access_token: enc,
      token_expires_at: expiresAt,
    })
    .eq("user_id", row.user_id);

  return { userId: row.user_id, googleEmail: row.google_email, accessToken: fresh.access_token };
}

/** placeholder to keep node:crypto referenced (silences unused-import lints if any added later) */
export function _signNop(s: string): string {
  return createHmac("sha256", "x").update(s).digest("hex").slice(0, 0) + s;
}

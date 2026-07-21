/**
 * LINE WORKS アクセストークンの取得(Service Account JWT → 発行 → キャッシュ)。
 *
 * 既存 LINE の「固定トークンをそのまま返す」構造とは異なり、LINE WORKS は
 * Service Account の JWT(RS256)から短命トークンを都度発行する。よって:
 *   1. lineworks_channels のキャッシュ(access_token_encrypted / token_expires_at)が
 *      有効ならそれを返す
 *   2. 失効していれば JWT を生成し jwt-bearer で発行 → 暗号化して再保存
 *   3. org 単位の single-flight で同時発行の二重化を防ぐ
 *
 * 公式仕様(2026-07 照合, developers.worksmobile.com/docs/auth-jwt):
 *   ・発行: POST https://auth.worksmobile.com/oauth2/v2.0/token(form-urlencoded)
 *   ・JWT: RS256 / iss=Client ID / sub=Service Account / exp ≤ iat+60分
 *   ・params: assertion(JWT) / grant_type=jwt-bearer / client_id / client_secret / scope(カンマ区切り)
 *
 * 注: refresh_token 更新フローは公式で厳密パラメータが未確定のため、当面は
 * 期限切れ時に JWT 再発行(確認済みで常に成功)する。将来 refresh に置換して最適化可。
 * 秘密鍵は PKCS8(-----BEGIN PRIVATE KEY-----)前提。
 */
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { createServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof createServiceClient>;

const AUTH_TOKEN_URL = "https://auth.worksmobile.com/oauth2/v2.0/token";
const JWT_TTL_SECONDS = 3600; // exp は iat + 最大 60 分

export type LineworksAccessContext = {
  organizationId: string;
  botId: string | null;
  accessToken: string;
};

function base64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** PEM(PKCS8)から DER バイト列を取り出す。 */
function pemToPkcs8Der(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(body, "base64"));
}

/** Service Account JWT(RS256)を Web Crypto で生成する。 */
async function createServiceAccountJwt(args: {
  clientId: string;
  serviceAccount: string;
  privateKeyPem: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: args.clientId,
    sub: args.serviceAccount,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    // Uint8Array<ArrayBufferLike> → BufferSource(既存 field-encryption と同じ明示キャスト)
    pemToPkcs8Der(args.privateKeyPem) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const signatureB64 = Buffer.from(new Uint8Array(signature)).toString("base64url");
  return `${signingInput}.${signatureB64}`;
}

/** 60 秒の余裕を見て失効判定(既存 Google/Zoom 実装と同基準)。 */
function isExpired(tokenExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!tokenExpiresAt) return true;
  const ms = new Date(tokenExpiresAt).getTime();
  if (Number.isNaN(ms)) return true;
  return ms - now.getTime() < 60_000;
}

// org 単位の single-flight(同時リクエストでの二重発行を防ぐ)
const inflight = new Map<string, Promise<LineworksAccessContext>>();

type TokenRow = {
  client_id: string;
  service_account: string;
  scopes: string;
  bot_id: string | null;
  client_secret_encrypted: string;
  private_key_encrypted: string;
  access_token_encrypted: string | null;
  token_expires_at: string | null;
  is_active: boolean;
};

export async function getLineworksAccessToken(args: {
  service: Service;
  organizationId: string;
}): Promise<LineworksAccessContext> {
  const key = args.organizationId;
  const running = inflight.get(key);
  if (running) return running;
  const promise = issueOrReuse(args).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function issueOrReuse(args: {
  service: Service;
  organizationId: string;
}): Promise<LineworksAccessContext> {
  const { service, organizationId } = args;
  const { data, error } = await service
    .from("lineworks_channels")
    .select(
      "client_id, service_account, scopes, bot_id, client_secret_encrypted, " +
        "private_key_encrypted, access_token_encrypted, token_expires_at, is_active",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) throw new Error("lineworks_channels 未登録");
  const row = data as unknown as TokenRow;
  if (!row.is_active) throw new Error("LINE WORKS 連携が無効化されています");

  // キャッシュが有効ならそのまま返す
  if (!isExpired(row.token_expires_at) && row.access_token_encrypted) {
    const cached = await decryptField(row.access_token_encrypted);
    if (cached) return { organizationId, botId: row.bot_id, accessToken: cached };
  }

  // 新規発行(JWT → jwt-bearer)
  const [clientSecret, privateKey] = await Promise.all([
    decryptField(row.client_secret_encrypted),
    decryptField(row.private_key_encrypted),
  ]);
  if (!clientSecret || !privateKey) throw new Error("資格情報の復号に失敗しました");

  const jwt = await createServiceAccountJwt({
    clientId: row.client_id,
    serviceAccount: row.service_account,
    privateKeyPem: privateKey,
  });

  const body = new URLSearchParams({
    assertion: jwt,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    client_id: row.client_id,
    client_secret: clientSecret,
    scope: row.scopes,
  });
  const res = await fetch(AUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!res.ok) {
    throw new Error(`LINE WORKS トークン発行に失敗: ${res.status} ${await res.text()}`);
  }
  const fresh = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };

  const encAccess = await encryptField(fresh.access_token);
  const expiresAt = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
  const update: Record<string, unknown> = { token_expires_at: expiresAt };
  if (encAccess) update.access_token_encrypted = encAccess;
  if (fresh.refresh_token) {
    const encRefresh = await encryptField(fresh.refresh_token);
    if (encRefresh) update.refresh_token_encrypted = encRefresh;
  }
  await service.from("lineworks_channels").update(update).eq("organization_id", organizationId);

  return { organizationId, botId: row.bot_id, accessToken: fresh.access_token };
}

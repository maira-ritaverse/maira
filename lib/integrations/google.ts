/**
 * Google OAuth 2.0 ヘルパ(Meet ミーティング作成用)
 *
 * Google Calendar API で Meet 付き イベントを 作成 する 構成。
 *
 * 2026-06-19 変更:
 *   ・drive.readonly スコープを 撤去。Google の Restricted scope(CASA 監査 必須)を
 *     回避するため、Meet 録画の Drive 自動取込は 廃止。
 *   ・Meet 録画は ユーザーが Myaira に 手動で アップロード する 運用に 切替え。
 *
 * 必要 scope:
 *   - openid email             : 本人特定(google_sub / google_email)
 *   - calendar.events          : Myaira からカレンダーイベント(= Meet URL 付き)の作成 / 編集 / 削除
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/**
 * 認可で要求するスコープ。
 *
 * - openid email             : 本人特定(google_sub / google_email)
 * - calendar.events          : Myaira からカレンダーイベント(= Meet URL 付き)の作成 / 編集 / 削除
 *
 * Sensitive scope(calendar.events)のみで構成し、Restricted scope は使わない。
 * Tier 2 OAuth verification(CASA 不要)で 公開可能。
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl.replace(/\/$/, "")}/api/integrations/google/callback`,
  };
}

export function buildAuthorizeUrl(config: GoogleConfig, state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", config.redirectUri);
  u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  // refresh_token を確実にもらうため
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

/**
 * トークン応答の scope 文字列に calendar.events が含まれているかを判定する純関数。
 * 設定画面で「再認可が必要です」バナーを出す判定に使う。
 */
export function hasCalendarEventsScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes("https://www.googleapis.com/auth/calendar.events");
}

/** scope 文字列に drive.readonly が含まれているかを判定する純関数 */
export function hasDriveReadonlyScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes("https://www.googleapis.com/auth/drive.readonly");
}

/**
 * scope 文字列を配列に正規化する純関数。
 * 空白区切りを split + 空要素除外。callback で scopes_granted カラムに保存する用途。
 */
export function parseGrantedScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter((s) => s.length > 0);
}

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
};

export async function exchangeCodeForTokens(
  config: GoogleConfig,
  code: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token endpoint failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

/** id_token を decode して sub/email を取り出す(署名検証は省略、最低限の取得用) */
export function decodeIdToken(idToken: string | undefined): { sub: string; email: string } | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    const payload = JSON.parse(Buffer.from(payloadB64 + pad, "base64").toString("utf8")) as {
      sub?: string;
      email?: string;
    };
    if (!payload.sub) return null;
    return { sub: payload.sub, email: payload.email ?? "" };
  } catch {
    return null;
  }
}

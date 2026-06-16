/**
 * Zoom OAuth(User-managed App)ヘルパ
 *
 * - 認可 URL の組み立て
 * - 認可コードからの token 交換
 * - refresh_token によるアクセストークン更新
 * - 録画ダウンロード(Cloud Recording のファイル URL に access_token をつけて GET)
 *
 * 注意:
 *   ・access/refresh トークンは呼び出し側で AES-256-GCM 暗号化して保存する
 *   ・本ファイルは Node ランタイム前提(fetch は使えるが、トークンを暗号化する
 *     呼び出し側で field-encryption(Web Crypto) を使うため Edge でも動作可)
 */

const AUTHORIZE_URL = "https://zoom.us/oauth/authorize";
const TOKEN_URL = "https://zoom.us/oauth/token";

/**
 * Zoom 認可で要求するスコープ。
 *
 * 用途別の意味:
 *   - cloud_recording:read       : 録画ファイルの取得(自動取込で必須)
 *   - user:read                  : /users/me で user.id / account_id を取得
 *   - meeting:read               : 既存ミーティング一覧 / 詳細の参照
 *   - meeting:write              : 新規ミーティング作成 / 編集 / 削除
 *
 * 既存接続済みユーザは scope に meeting:write を含まないため、設定画面で
 * 「Maira から会議を作成」機能を使うとき再認可を促す。`scopes_granted` カラム
 * (zoom_connections)を参照して UI 側でハンドリングする。
 */
export const ZOOM_SCOPES = [
  "cloud_recording:read",
  "user:read",
  "meeting:read",
  "meeting:write",
] as const;

export type ZoomConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** env から Zoom 設定を読む。未設定なら null。 */
export function getZoomConfig(): ZoomConfig | null {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl.replace(/\/$/, "")}/api/integrations/zoom/callback`,
  };
}

/**
 * Zoom 認可 URL を組み立てる。
 *
 * scope は ZOOM_SCOPES の配列を半角スペース区切りで明示する。
 * Zoom App 側にも同じ scope を登録しておく必要がある(片方が欠けると認可成功
 * してもトークンに含まれない)。
 */
export function buildAuthorizeUrl(config: ZoomConfig, state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", config.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", ZOOM_SCOPES.join(" "));
  return u.toString();
}

/**
 * トークン応答の scope 文字列に meeting:write が含まれているかを判定する純関数。
 * 設定画面で「再認可が必要です」バナーを出す判定に使う。
 */
export function hasMeetingWriteScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes("meeting:write");
}

/**
 * scope 文字列を配列に正規化する純関数。
 * callback で scopes_granted カラムに保存する用途。
 */
export function parseZoomGrantedScopes(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter((s) => s.length > 0);
}

export type ZoomTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: "bearer";
};

async function postToken(config: ZoomConfig, body: URLSearchParams): Promise<ZoomTokens> {
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom token endpoint failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ZoomTokens;
}

/** 認可コードを token に交換 */
export function exchangeCodeForTokens(config: ZoomConfig, code: string): Promise<ZoomTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  return postToken(config, body);
}

/** refresh_token でアクセストークンを更新 */
export function refreshTokens(config: ZoomConfig, refreshToken: string): Promise<ZoomTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postToken(config, body);
}

/** /users/me で Zoom 側ユーザ情報を取得(account_id 突合用) */
export async function fetchMe(
  accessToken: string,
): Promise<{ id: string; account_id: string; email: string }> {
  const res = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Zoom /users/me failed: ${res.status}`);
  }
  return (await res.json()) as { id: string; account_id: string; email: string };
}

/**
 * トークンが「期限切れか / 期限近接(< 60 秒)」かを判定する純関数。
 * 期限が null のときは「期限不明 = リフレッシュしておく」方針。
 */
export function isTokenExpired(tokenExpiresAt: string | null, now: Date = new Date()): boolean {
  if (!tokenExpiresAt) return true;
  const ms = new Date(tokenExpiresAt).getTime();
  if (Number.isNaN(ms)) return true;
  return ms - now.getTime() < 60_000;
}

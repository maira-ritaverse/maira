/**
 * NEXT_PUBLIC_SITE_URL の参照を 1 箇所に集約する。
 *
 * 背景:
 *   ・呼び出し側ごとに `?? "https://maira.pro"` / `?? "http://localhost:3000"` /
 *     `?? ""` などフォールバックがばらついていた
 *   ・空文字 fallback は途中で `${siteUrl}${href}` に使われたとき "/path" となり
 *     ブラウザは現在オリジン補完で動くが、メール本文の絶対 URL では壊れる
 *   ・「dev は localhost / prod は環境変数」を一貫して期待値にする
 *
 * 方針:
 *   ・env が設定済なら末尾スラッシュを除去して返す
 *   ・未設定なら NODE_ENV で出し分け:
 *       development → http://localhost:3000(ローカル dev サーバ前提)
 *       それ以外    → https://maira.pro(プレースホルダ、本番は env 必須)
 *
 * 注意:
 *   ・絶対 URL が必要な場面(メール本文 / OG / robots / sitemap / OAuth redirect)で使う
 *   ・相対パスで足りる場面(SSR の Link)では使わない
 */

const PRODUCTION_FALLBACK = "https://maira.pro";
const DEV_FALLBACK = "http://localhost:3000";

/**
 * サイトの絶対 URL(末尾スラッシュなし)を返す。
 */
export function getSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return DEV_FALLBACK;
  return PRODUCTION_FALLBACK;
}

/**
 * `getSiteUrl()` の後ろに path を連結する小ヘルパ。
 * path は先頭スラッシュを含んでも含まなくても OK(自動で正規化)。
 */
export function buildAbsoluteUrl(path: string): string {
  const base = getSiteUrl();
  if (!path) return base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

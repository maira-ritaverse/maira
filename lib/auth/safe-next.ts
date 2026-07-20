/**
 * 認証フロー共通の next パス検証。
 *
 * 用途:
 *   - /auth/callback?next=...(メール確認後の戻り先)
 *   - /login?next=...(ログイン後の戻り先)
 *   - /signup?invitationToken=... 経由の戻り先など
 *
 * 同一オリジン内のパス(/ から始まる、// で始まらない、バックスラッシュ無し)
 * のみ許可。緩めると open redirect(任意の外部 URL に飛ばす)になって
 * フィッシングに利用されうるため、厳しめに絞る。
 *
 * 例:
 *   "/invite/abc"           → true
 *   "/app"                  → true
 *   "/login?x=1"       → true(クエリ付きでも origin 内)
 *   "//evil.com/x"          → false(scheme-relative)
 *   "https://evil.com/x"    → false(絶対 URL)
 *   "javascript:alert(1)"   → false(scheme-relative ではないが / で始まらない)
 *   "\\evil.com"            → false(Windows パス区切りでの回避防止)
 *   null / 空文字            → false
 */
export function isSafeNextPath(next: string | null | undefined): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.includes("\\")) return false;
  // ★API / Next 内部 / 認証 経路 は 「ページ 遷移 先」 として 無効。
  //     ・/api/*  → JSON レスポンス 直接 表示 (フィッシング 材料)
  //     ・/_next/* → 内部 静的 資産
  //     ・/auth/*  → callback / confirm (再 走行 で 意図 せぬ 副作用)
  //     ・/login/mfa は MFA 検証 後 の 遷移先 として 意味 が ない (無限 ループ)
  //     セキュリティ 監査 MFA #6 の 対応。
  if (
    next.startsWith("/api/") ||
    next.startsWith("/_next/") ||
    next.startsWith("/auth/") ||
    next === "/login/mfa" ||
    next.startsWith("/login/mfa?")
  ) {
    return false;
  }
  return true;
}

/**
 * 安全な next パスを返す。検証 NG の場合は fallback を返す。
 * ログイン Server Action 等で「next を尊重しつつ既定値にフォールバック」したいときに使う。
 */
export function safeNextOr(next: string | null | undefined, fallback: string): string {
  return isSafeNextPath(next) ? next : fallback;
}

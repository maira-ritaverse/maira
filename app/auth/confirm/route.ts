import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { safeNextOr } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * /auth/confirm
 *
 * メールリンク経由の認証(招待 / パスワードリセット / メール確認 / メアド変更)
 * を受け付けるエンドポイント。
 *
 * 経緯:
 *   ・/auth/callback の exchangeCodeForSession(code) は OAuth フロー専用で、
 *     受信者ブラウザに PKCE code_verifier クッキーが必要。
 *   ・メールリンクの受信者(別ブラウザ / 別端末でクリック)には code_verifier
 *     が無いため、招待 / リセットフローは一律に失敗していた。
 *   ・Supabase 公式 SSR ガイドどおり、メール系は token_hash を verifyOtp で
 *     検証する。code_verifier を必要としない。
 *
 * クエリ:
 *   ・token_hash : generateLink({type}) の properties.hashed_token
 *   ・type       : "invite" / "recovery" / "signup" / "magiclink" / "email_change"
 *   ・next       : 検証成功後の遷移先(safeNextOr で同一オリジン制限)
 *
 * 失敗時:
 *   /login?error=auth_callback_failed に統一(/auth/callback と揃える)。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextOr(searchParams.get("next"), "/app");

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { safeNextOr } from "@/lib/auth/safe-next";

/**
 * Supabaseからのメール確認後のコールバックハンドラ
 *
 * フロー:
 * 1. ユーザーが新規登録 → 確認メール送信
 * 2. ユーザーがメール内リンクをクリック
 * 3. Supabaseが ?code=xxx を付けて このハンドラにリダイレクト
 * 4. codeをセッションに交換して next(既定 /app)にリダイレクト
 *
 * next の用途:
 *   招待経由のサインアップでは signup() が next=/invite/[token] を
 *   emailRedirectTo に埋めている。ここで読み戻して着地ページに戻す。
 *   不正な next は捨てて /app にフォールバックする。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextOr(searchParams.get("next"), "/app");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // エラー時はログインページに戻す
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`);
}

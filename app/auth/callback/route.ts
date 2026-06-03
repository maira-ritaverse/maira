import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * next パラメータの安全性チェック。
 * 同一オリジン内のパス(/ から始まる、// で始まらない、プロトコル無し)のみ許可。
 *
 * なぜ厳しめに:
 *   next は招待リンク → サインアップ → callback で /invite/[token] に
 *   戻すために使うが、ここを緩めると open redirect(任意の外部 URL へ飛ばす)に
 *   なってフィッシングに利用されうる。同一オリジン内パスに限定する。
 *
 * 例:
 *   "/invite/abc"           → OK
 *   "/app"                  → OK
 *   "//evil.com/x"          → NG(scheme-relative)
 *   "https://evil.com/x"    → NG
 *   "/auth/login?next=/x"   → OK(クエリ付きでも origin 内)
 */
function isSafeNextPath(next: string | null): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.includes("\\")) return false;
  return true;
}

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
  const nextRaw = searchParams.get("next");
  const next = isSafeNextPath(nextRaw) ? nextRaw : "/app";

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

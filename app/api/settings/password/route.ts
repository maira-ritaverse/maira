import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { changePasswordRequestSchema } from "@/lib/settings/types";

/**
 * POST /api/settings/password
 *
 * パスワード変更フロー:
 * 1. 認証中ユーザーを getUser() で取得
 * 2. signInWithPassword で「現在のパスワード」を検証
 *    → 検証 NG なら 401(本人にメッセージを返してよい:ログイン中のため列挙攻撃にはならない)
 * 3. updateUser({ password }) で新パスワードに更新
 *
 * 注:signInWithPassword はサーバー側でセッションを再発行するが、
 * @supabase/ssr の cookie 管理が自動でレスポンス Cookie に反映するため
 * クライアントの再ログインは不要。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // user.email が無いケース(OAuth 等)は将来対応:今はメール/パスワード認証のみ
  if (!user || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = changePasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { current_password, new_password } = parsed.data;

  // 1. 現在パスワードを再認証で検証
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });

  if (signInError) {
    return NextResponse.json(
      {
        error: "Invalid current password",
        message: "現在のパスワードが正しくありません",
      },
      { status: 401 },
    );
  }

  // 2. 新パスワードへ更新
  const { error: updateError } = await supabase.auth.updateUser({
    password: new_password,
  });

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update password", message: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

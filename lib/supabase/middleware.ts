import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextOr } from "@/lib/auth/safe-next";

/**
 * Next.jsのmiddlewareで使用するSupabaseクライアントとセッション更新ヘルパー
 *
 * 責務:
 * - セッションのCookieを自動で更新(getUser()がリフレッシュをトリガーする)
 * - /app配下:未ログイン者を /auth/login へリダイレクト
 * - /auth配下(callbackを除く):既ログイン者を /app へリダイレクト
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // セッションを更新(必須:このgetUser()がCookieリフレッシュをトリガーする)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // /invite/[token] は公開ルート:ログイン有無どちらでも素通し。
  // - 未ログイン:着地ページで「ログイン/登録して下さい」を表示するため
  // - ログイン済み:同じ着地ページで「受諾する」or「メール不一致でログアウト」を表示するため
  //   /auth 配下ではないので「ログイン済みは /app に飛ばす」ルールは元々当たらないが、
  //   将来の正規化(例:/auth/invite に統合)時の事故を防ぐため、明示的に早期 return する。
  if (pathname.startsWith("/invite/")) {
    return supabaseResponse;
  }

  // /auth/reset-password は公開ルート扱い:
  //   リセットメール → callback で ?code= 交換 → ここに「ログイン済み」状態で着地する。
  //   下の「/auth 配下 + ログイン済み → /app」ルールに引っかかると新パスワードを
  //   入力できなくなるため、明示的に早期 return する。
  //   逆に「未ログイン」で直接アクセスされたケースはセッションが立っておらず、
  //   ページ側で updatePassword を呼ぶと「セッションが無効」エラーが返るので、
  //   フォーム側で再リクエスト導線を出す方針(ここでリダイレクトはしない)。
  if (pathname.startsWith("/auth/reset-password")) {
    return supabaseResponse;
  }

  // /app配下:認証必須(未ログインなら /auth/login へ)
  if (pathname.startsWith("/app") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // /auth配下(callbackを除く):未認証者専用(既ログインなら通常 /app へ)
  // callbackはセッション交換中なので除外しないとループする
  //
  // 例外:?next= が同一オリジン内パスなら、そちらを優先する。
  //   招待リンク経由(/auth/login?next=/invite/X)で既にログイン済みの場合に、
  //   /app に飛ばしてしまうと招待フローから脱落するため、next を尊重して
  //   そのまま着地ページに送り直す。open redirect は safeNextOr で阻止。
  if (pathname.startsWith("/auth") && !pathname.startsWith("/auth/callback") && user) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const target = safeNextOr(nextParam, "/app");
    // target はクエリを含む可能性があるため、相対 URL として origin と結合する。
    return NextResponse.redirect(new URL(target, request.nextUrl.origin));
  }

  return supabaseResponse;
}

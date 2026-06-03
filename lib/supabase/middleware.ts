import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // /app配下:認証必須(未ログインなら /auth/login へ)
  if (pathname.startsWith("/app") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // /auth配下(callbackを除く):未認証者専用(既ログインなら /app へ)
  // callbackはセッション交換中なので除外しないとループする
  if (pathname.startsWith("/auth") && !pathname.startsWith("/auth/callback") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

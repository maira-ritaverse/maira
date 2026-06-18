import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextOr } from "@/lib/auth/safe-next";

/**
 * Next.jsのmiddlewareで使用するSupabaseクライアントとセッション更新ヘルパー
 *
 * 責務:
 * - セッションのCookieを自動で更新(getUser()がリフレッシュをトリガーする)
 * - /app配下:未ログイン者を /login へリダイレクト
 * - 認証ページ(/login, /signup, /forgot-password, /verify-email):既ログイン者を /app へリダイレクト
 * - /auth/callback はセッション交換中なので対象外
 */

// 認証ページ:未認証者専用。既ログインでアクセスしたら /app(または next= 先)に飛ばす。
// /reset-password は意図的に含めない(下のロジックで早期 return している)。
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/verify-email"] as const;
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

  // /reset-password は公開ルート扱い:
  //   リセットメール → callback で ?code= 交換 → ここに「ログイン済み」状態で着地する。
  //   下の「/auth 配下 + ログイン済み → /app」ルールに引っかかると新パスワードを
  //   入力できなくなるため、明示的に早期 return する。
  //   逆に「未ログイン」で直接アクセスされたケースはセッションが立っておらず、
  //   ページ側で updatePassword を呼ぶと「セッションが無効」エラーが返るので、
  //   フォーム側で再リクエスト導線を出す方針(ここでリダイレクトはしない)。
  if (pathname.startsWith("/reset-password")) {
    return supabaseResponse;
  }

  // /app配下:認証必須(未ログインなら /login へ)
  if (pathname.startsWith("/app") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 認証ページ(/login, /signup, /forgot-password, /verify-email):未認証者専用。
  // 既ログインなら通常デフォルト位置にリダイレクトする。
  // /auth/callback はセッション交換中なので対象外(そもそも AUTH_PAGES に入っていない)。
  //
  // デフォルト位置の決め方:
  //   ・next= があれば最優先(招待リンク経由 /login?next=/invite/X のように、
  //     特定ページへ戻したい意図を尊重)
  //   ・無ければ account_type を見て /agency か /app を選ぶ
  //     (org member を /app に送ると app layout から再リダイレクトが走るため、
  //      最初から正しい位置に送る)
  //   ・account_type を読めない場合は安全側で /app(seeker 想定)
  //
  // open redirect は safeNextOr で阻止。
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isAuthPage && user) {
    const nextParam = request.nextUrl.searchParams.get("next");
    if (nextParam) {
      const target = safeNextOr(nextParam, "/app");
      return NextResponse.redirect(new URL(target, request.nextUrl.origin));
    }
    // 既ログインのデフォルト遷移先を account_type で分岐
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_type")
      .eq("id", user.id)
      .maybeSingle();
    const defaultPath = profile?.account_type === "organization_member" ? "/agency" : "/app";
    return NextResponse.redirect(new URL(defaultPath, request.nextUrl.origin));
  }

  return supabaseResponse;
}

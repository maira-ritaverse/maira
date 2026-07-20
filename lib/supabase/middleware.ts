import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextOr } from "@/lib/auth/safe-next";
import { isPlanReadOnly, type PlanReadState } from "@/lib/billing/plan-status";

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

/**
 * 読み取り専用モード中でも書き込みを許可する API パス。
 *
 * 主に「契約状態を復旧するための操作」= /agency/billing/*。
 * これを塞ぐと read-only になった組織が Checkout/Portal に到達できず詰む。
 */
const WRITE_ALLOWED_WHEN_READONLY = [
  "/api/agency/billing/", // 全 billing 系 API
] as const;

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Origin ヘッダ ベース の CSRF 防御 で 除外 する パス。
 *
 * ・外部 サービス からの POST (webhook / cron / OAuth callback) は Origin が
 *   自分 の ドメイン と 一致 しない or 付か ない ため、 origin check を 通すと
 *   全 弾き に なる。 これら は 各 route の 側 で 個別 に 署名 検証 / 秘密 検証
 *   を 行って いる (Stripe / LINE / Zoom webhook の HMAC、 cron 共有 秘密、
 *   OAuth state) の で、 二重 に origin まで 求める 必要 は ない。
 */
const CSRF_EXEMPT_PREFIXES = [
  "/api/webhooks/",
  "/api/internal/",
  "/api/public/",
  "/api/integrations/", // OAuth callback (Stripe / Zoom)
  "/api/liff/", // LINE LIFF (別 Origin から の 呼出)
  "/api/self-serve/", // 未 認証 / 別 経路 から の POST を 許容
  "/auth/callback",
];
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

  // ── CSRF: 書込 メソッド の Origin を 自 ドメイン と 一致 検証 (セキュリティ 監査 H3)。
  //     SameSite=Lax の Supabase セッション cookie は top-level GET には 付与 される
  //     が、 POST/PATCH/PUT/DELETE の cross-site 送信 (form submit / fetch) には
  //     付与 されない。 それでも 同一 eTLD+1 (maira.pro ↔ app.maira.pro) や
  //     Vercel preview URL への XSS で セッション riding される 可能性 が 残る ため、
  //     Origin ヘッダ が 自身 の origin と 一致 しない 書込 は 403 で 弾く。
  //     Webhook / cron / OAuth callback は 外部 origin から 来る の で 除外。
  if (WRITE_METHODS.has(request.method)) {
    const exempt = CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
    if (!exempt) {
      const origin = request.headers.get("origin");
      // Origin が 無い ケース: same-origin fetch (SPA 内) は 通常 Origin を 付与
      // する ため、 純粋 に 無い の は 攻撃 者 の 手作り リクエスト の 可能性 が 高い。
      // ただし 一部 の Server Action / navigation は Origin を 付けない ため、
      // Sec-Fetch-Site の 有無 も 見て 判定 する (same-origin / same-site なら OK)。
      const secFetchSite = request.headers.get("sec-fetch-site");
      const originOk = origin === request.nextUrl.origin;
      const fetchSiteOk = secFetchSite === "same-origin" || secFetchSite === "same-site";
      if (!originOk && !fetchSiteOk) {
        return NextResponse.json(
          {
            error: "csrf_origin_mismatch",
            message: "リクエストの Origin が許可されていません。",
          },
          { status: 403 },
        );
      }
    }
  }

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

  // 課金プランに基づく書き込みゲート:
  //   /api/agency/** の POST/PATCH/PUT/DELETE のうち、billing 系以外は
  //   isPlanReadOnly(plan) が true の組織からのリクエストを 403 で弾く。
  //   これにより 108+ ある write route を個別に触らず、middleware 1 箇所で網羅。
  //   ・GET は素通し (「読み取り専用」= 既存データの閲覧は OK)
  //   ・未ログインは既存の 401 経路に任せる
  //   ・organization_plans が無い / 免除 / active / trialing (期限内) は通す
  if (
    user &&
    pathname.startsWith("/api/agency/") &&
    WRITE_METHODS.has(request.method) &&
    !WRITE_ALLOWED_WHEN_READONLY.some((prefix) => pathname.startsWith(prefix))
  ) {
    const readOnly = await checkPlanReadOnlyForUser(supabase, user.id);
    if (readOnly) {
      return NextResponse.json(
        {
          error: "plan_read_only",
          message:
            "無料期間終了 / 契約終了 / 決済失敗のため、現在は読み取り専用モードです。契約管理ページでご対応ください。",
        },
        { status: 403 },
      );
    }
  }

  return supabaseResponse;
}

/**
 * user_id から所属組織の plan を引いて read-only か判定。
 * middleware 内から呼ぶ た め、RLS 経由 (anon key + user cookie) で 実行。
 * 2 クエリ (members + plans) 走る が、write request のみ に 限定 して 呼ぶ。
 */
async function checkPlanReadOnlyForUser(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<boolean> {
  const { data: memberRow } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    // soft delete された メンバー は 除外
    .is("removed_at", null)
    .maybeSingle();
  if (!memberRow) return false; // seeker or 未所属:個別 route の 401/403 に任せる

  const orgId = (memberRow as { organization_id: string }).organization_id;
  const { data: planRow } = await supabase
    .from("organization_plans")
    .select("status, trial_ends_at, stripe_subscription_id, is_billing_exempt")
    .eq("organization_id", orgId)
    .maybeSingle();

  return isPlanReadOnly((planRow ?? null) as PlanReadState | null);
}

import { NextResponse } from "next/server";

import { safeNextOr } from "@/lib/auth/safe-next";
import { encryptField } from "@/lib/crypto/field-encryption";
import { parseGrantedScopes } from "@/lib/integrations/google";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabaseからの OAuth / メール確認コールバックハンドラ
 *
 * 兼用フロー:
 * 1. メール確認(signUp の emailRedirectTo)からの戻り
 * 2. Google OAuth (signInWithOAuth) からの戻り
 *
 * 処理:
 *   ・?code= をセッションに交換
 *   ・Google OAuth の場合は session.provider_token / provider_refresh_token が
 *     1 回だけ取れるので、その場で google_connections に暗号化して保存する
 *     (※ Supabase Auth は provider_refresh_token を保存しないため、
 *       Myaira 側で AES-256-GCM 暗号化して自前保管する)
 *   ・next の用途:
 *       招待経由のサインアップでは signup() / startGoogleAuth() が
 *       next=/invite/[token] を組んでくる。ここで読み戻して着地ページに戻す。
 *       不正な next は捨てて /app にフォールバックする。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextOr(searchParams.get("next"), "/app");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // ─── 求職者(client_record)招待の自動受諾 ─────────────────────────
  // pending な client_invitations が「caller の email と一致」していれば
  // accept する。トークンの受け渡し無しで成立させるため、callback で
  // 常時呼ぶ(該当無しは no-op)。
  // 失敗しても認証自体は成立済みなので、ログだけ残して継続する。
  try {
    const { error: acceptErr } = await supabase.rpc("accept_client_invitation");
    if (acceptErr) {
      console.error("[auth/callback] accept_client_invitation failed", acceptErr.message);
    }
  } catch (err) {
    console.error("[auth/callback] accept_client_invitation threw", err);
  }

  // ─── Google OAuth の戻りなら provider_token を google_connections に保存 ────
  // Supabase の session.provider_token / provider_refresh_token は
  // この exchangeCodeForSession の直後にだけ取得できる。
  // 後段の getSession() では provider_refresh_token は失われる仕様。
  const session = data.session;
  if (session.provider_token && session.user) {
    try {
      const userId = session.user.id;
      const accessToken = session.provider_token;
      const refreshToken = session.provider_refresh_token ?? null;
      // Google identity からメール / sub を取得(profiles の display_name 用にも)
      const identity = session.user.identities?.find((i) => i.provider === "google");
      const identityData = identity?.identity_data as { sub?: string; email?: string } | undefined;
      const googleSub = identityData?.sub;
      const googleEmail = identityData?.email ?? session.user.email ?? null;

      // 既存接続があり、refresh_token が新しく来ていない場合は既存値を尊重
      let encryptedRefresh: string | null = null;
      if (refreshToken) {
        encryptedRefresh = await encryptField(refreshToken);
      } else {
        const { data: existing } = await supabase
          .from("google_connections")
          .select("encrypted_refresh_token")
          .eq("user_id", userId)
          .maybeSingle();
        encryptedRefresh =
          (existing as { encrypted_refresh_token: string | null } | null)
            ?.encrypted_refresh_token ?? null;
      }

      const encryptedAccess = await encryptField(accessToken);

      // expires_in は session.expires_in、無ければ session.expires_at から逆算
      const expiresAt =
        session.expires_at != null
          ? new Date(session.expires_at * 1000).toISOString()
          : new Date(Date.now() + 60 * 60 * 1000).toISOString();

      // scope はクライアントが要求したもので、Supabase が provider_token に
      // 紐づくスコープを返す経路は無い。startGoogleAuth() で要求した
      // スコープ群を期待値として保存する。
      const expectedScope =
        "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly";

      if (encryptedAccess && encryptedRefresh) {
        await supabase.from("google_connections").upsert(
          {
            user_id: userId,
            google_sub: googleSub ?? null,
            google_email: googleEmail,
            encrypted_access_token: encryptedAccess,
            encrypted_refresh_token: encryptedRefresh,
            scope: expectedScope,
            scopes_granted: parseGrantedScopes(expectedScope),
            token_expires_at: expiresAt,
          },
          { onConflict: "user_id" },
        );
      }
    } catch (err) {
      // 保存失敗は致命ではない(本人のログインは成立しているため、
      // 後で設定画面の「Google を連携」から手動で繋ぎ直せる)。
      console.error("[auth/callback] google_connections upsert failed", err);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}

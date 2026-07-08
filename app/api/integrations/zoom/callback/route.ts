import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import {
  exchangeCodeForTokens,
  fetchMe,
  getZoomConfig,
  parseZoomGrantedScopes,
} from "@/lib/integrations/zoom";

/**
 * GET /api/integrations/zoom/callback?code=...&state=...
 *
 * Zoom からの OAuth コールバック。code を access/refresh トークンに交換し、
 * AES-256-GCM で暗号化して zoom_connections に upsert する。
 *
 * 成功時は /agency/settings/integrations にバナー付きで戻す。
 */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/agency/settings/integrations?error=${encodeURIComponent(errorParam)}`, request.url),
    );
  }
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  // state は Maira 内から /connect を 起点 に した 場合 に 発行 される CSRF トークン。
  // Zoom Marketplace の install / Beta Test ボタン 経由 で OAuth が 開始 された 場合 は
  // state が 付与 され ない (Zoom 側 仕様)。 その 場合 は state 無し でも 受け入れる が、
  // ログイン 中 の ユーザー の セッション を CSRF 防御 として 信頼 する。
  //   ・既 に ログイン 済 (requireUser で 保証) = 攻撃 者 の セッション で 強制 連携 不可
  //   ・連携 先 user_id は 現在 の ログイン ユーザー で 確定
  //
  // H1 修正 (2026-07-08): SameSite=Lax の Supabase セッション cookie は top-level
  // GET でも 付与 される ため、 攻撃 者 が 自 分 の Zoom アカウント の 認可 code を
  // Marketplace 経由 で 取得 → 被害 者 に URL クリック さ せる → 被害 者 の
  // zoom_connections が upsert (onConflict: user_id) で 攻撃 者 の refresh_token に
  // 上書き さ れる 経路 が 残って いた。 state 無し 経路 では 追加 で 「既存 の
  // zoom_user_id が 別人 か どう か」 を 検証 し、 異なる 場合 は 400 で 拒否 する。
  const stateVerified = Boolean(state);
  if (state) {
    const verified = verifyOAuthState(state);
    if (!verified.ok) {
      return NextResponse.json({ error: "bad_state", reason: verified.reason }, { status: 400 });
    }
    if (verified.payload.uid !== user.id || verified.payload.provider !== "zoom") {
      return NextResponse.json({ error: "state_user_mismatch" }, { status: 400 });
    }
  } else {
    console.warn("[zoom-callback] state-less install accepted", { user_id: user.id });
  }

  const config = getZoomConfig();
  if (!config) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(config, code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "token_exchange_failed", message: msg }, { status: 502 });
  }

  // Zoom 側 user_id / account_id を 取得 して 保存 (webhook 突合 用)
  let me: Awaited<ReturnType<typeof fetchMe>> | null = null;
  try {
    me = await fetchMe(tokens.access_token);
  } catch {
    // 取れ なくて も 接続 自体 は 成立 させる
  }

  // H1 修正: state 無し 経路 では 既存 の zoom_user_id と 一致 を 検証。
  // 一度 でも 連携 した ユーザー の Zoom アカウント が 別 の アカウント に
  // 差し 替わる 経路 を 塞ぐ。 state 検証 済 の 場合 は 通常 の /connect 経由 な の で
  // 差し替え は 意図 と 見な す (ユーザー 自身 が 別 Zoom アカウント へ の 切り替え
  // を 要求 した ケース)。
  if (!stateVerified && me?.id) {
    const { data: existing } = await supabase
      .from("zoom_connections")
      .select("zoom_user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing?.zoom_user_id && existing.zoom_user_id !== me.id) {
      console.warn("[zoom-callback] zoom_user_id mismatch on state-less install", {
        user_id: user.id,
        existing_zoom_user_id: existing.zoom_user_id,
        incoming_zoom_user_id: me.id,
      });
      return NextResponse.redirect(
        new URL("/agency/settings/integrations?error=zoom_account_mismatch", request.url),
      );
    }
  }

  const encryptedAccess = await encryptField(tokens.access_token);
  const encryptedRefresh = await encryptField(tokens.refresh_token);
  if (!encryptedAccess || !encryptedRefresh) {
    return NextResponse.json({ error: "encryption_failed" }, { status: 500 });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  // scope 文字列 + 配列の両方を保存(連携状態の UI 表示で配列を読む)
  const scopesGranted = parseZoomGrantedScopes(tokens.scope);
  const { error } = await supabase.from("zoom_connections").upsert(
    {
      user_id: user.id,
      zoom_user_id: me?.id ?? null,
      zoom_account_id: me?.account_id ?? null,
      encrypted_access_token: encryptedAccess,
      encrypted_refresh_token: encryptedRefresh,
      scope: tokens.scope,
      scopes_granted: scopesGranted,
      token_expires_at: expiresAt,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json(
      { error: "db_upsert_failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.redirect(
    new URL("/agency/settings/integrations?connected=zoom", request.url),
  );
}

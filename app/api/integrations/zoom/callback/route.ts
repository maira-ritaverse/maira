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
  //
  // 【方針 変更 (セキュリティ 監査 W3)】
  //   従来 は Zoom Marketplace 由来 の state-less install も 受け入れて いた が、
  //   「初回 連携 の 被害者 に クリック さ せて 攻撃者 の Zoom アカウント を 紐付ける」
  //   経路 が 塞げ ない (既存 zoom_connections 行 が 無い ため mismatch 判定 が
  //   効か ない)。 state を 必須 化 し、 Marketplace 経由 install で state が
  //   落ちて いる 場合 は Maira 側 の 設定 ページ に 誘導 → 明示的 に Connect ボタン
  //   から state 付き で 開始 させる。 UX 上 の 迂回 コスト は 1 クリック 増加 のみ。
  if (!state) {
    return NextResponse.redirect(
      new URL("/agency/settings/integrations?error=zoom_state_required", request.url),
    );
  }
  const verified = verifyOAuthState(state);
  if (!verified.ok) {
    return NextResponse.json({ error: "bad_state", reason: verified.reason }, { status: 400 });
  }
  if (verified.payload.uid !== user.id || verified.payload.provider !== "zoom") {
    return NextResponse.json({ error: "state_user_mismatch" }, { status: 400 });
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

  // 注: state を 必須 化 した (上 の early redirect) の で、 state-less install で
  //     zoom_user_id を 差し 替える 攻撃 経路 は そもそも 到達 しない。 従来 の
  //     「state 無し + 既存 zoom_user_id 不一致 で reject」 の 二重 ガード は
  //     不要 に なった の で 削除。

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

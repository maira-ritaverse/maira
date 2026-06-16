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
  if (!code || !state) {
    return NextResponse.json({ error: "missing_code_or_state" }, { status: 400 });
  }

  const verified = verifyOAuthState(state);
  if (!verified.ok) {
    return NextResponse.json({ error: "bad_state", reason: verified.reason }, { status: 400 });
  }
  // session すり替え対策:state の uid と現在のログインユーザが一致しないと拒否
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

  // Zoom 側 user_id / account_id を取得して保存(webhook 突合用)
  let me: Awaited<ReturnType<typeof fetchMe>> | null = null;
  try {
    me = await fetchMe(tokens.access_token);
  } catch {
    // 取れなくても接続自体は成立させる
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

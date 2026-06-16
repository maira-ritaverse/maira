import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import {
  decodeIdToken,
  exchangeCodeForTokens,
  getGoogleConfig,
  parseGrantedScopes,
} from "@/lib/integrations/google";

/**
 * GET /api/integrations/google/callback?code=...&state=...
 *
 * Google からのコールバック。token 交換 → 暗号化 → google_connections に upsert。
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
  if (verified.payload.uid !== user.id || verified.payload.provider !== "google") {
    return NextResponse.json({ error: "state_user_mismatch" }, { status: 400 });
  }

  const config = getGoogleConfig();
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

  // 再接続では refresh_token が返らないケースがあるため、その場合は既存値を尊重
  let encryptedRefresh: string | null = null;
  if (tokens.refresh_token) {
    encryptedRefresh = await encryptField(tokens.refresh_token);
  } else {
    const { data: existing } = await supabase
      .from("google_connections")
      .select("encrypted_refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();
    encryptedRefresh = existing?.encrypted_refresh_token ?? null;
  }
  if (!encryptedRefresh) {
    return NextResponse.json(
      {
        error: "missing_refresh_token",
        message:
          "Google から refresh_token が得られませんでした。一度切断してから再接続してください。",
      },
      { status: 400 },
    );
  }

  const encryptedAccess = await encryptField(tokens.access_token);
  if (!encryptedAccess) {
    return NextResponse.json({ error: "encryption_failed" }, { status: 500 });
  }

  const identity = decodeIdToken(tokens.id_token);

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  // scope 文字列 + 配列の両方を保存(連携状態の UI 表示で配列を読む)
  const scopesGranted = parseGrantedScopes(tokens.scope);
  const { error } = await supabase.from("google_connections").upsert(
    {
      user_id: user.id,
      google_sub: identity?.sub ?? null,
      google_email: identity?.email ?? null,
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
    new URL("/agency/settings/integrations?connected=google", request.url),
  );
}

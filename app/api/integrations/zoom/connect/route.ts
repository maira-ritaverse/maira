import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { hasAddon } from "@/lib/features/entitlements";
import { buildAuthorizeUrl, getZoomConfig } from "@/lib/integrations/zoom";
import { createOAuthState } from "@/lib/integrations/oauth-state";

/**
 * GET /api/integrations/zoom/connect
 *
 * Zoom OAuth 認可フローを開始する。アドオン契約者のみ実行可能。
 * 成功時は Zoom の認可ページに 302 で飛ばす。
 *
 * state は user_id + provider + ts を HMAC で署名して載せる(CSRF 対策)。
 * 完了後 /api/integrations/zoom/callback に code + state がコールバックされる。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // アドオン契約が必要(将来 Stripe と紐づけたら自動で is_active が落ちる)
  const addonOk = await hasAddon(supabase, user.id, "meeting_recording_auto");
  if (!addonOk) {
    return NextResponse.json(
      { error: "addon_required", addon: "meeting_recording_auto" },
      { status: 402 },
    );
  }

  const config = getZoomConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "Zoom App の OAuth 設定がサーバ側に登録されていません。",
      },
      { status: 503 },
    );
  }

  const state = createOAuthState(user.id, "zoom");
  const url = buildAuthorizeUrl(config, state);
  return NextResponse.redirect(url);
}

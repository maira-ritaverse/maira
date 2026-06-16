import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { hasAddon } from "@/lib/features/entitlements";
import { buildAuthorizeUrl, getGoogleConfig } from "@/lib/integrations/google";
import { createOAuthState } from "@/lib/integrations/oauth-state";

/**
 * GET /api/integrations/google/connect
 *
 * Google OAuth 認可フローを開始。アドオン契約者のみ。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const addonOk = await hasAddon(supabase, user.id, "meeting_recording_auto");
  if (!addonOk) {
    return NextResponse.json(
      { error: "addon_required", addon: "meeting_recording_auto" },
      { status: 402 },
    );
  }

  const config = getGoogleConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "Google OAuth 設定がサーバ側に登録されていません。",
      },
      { status: 503 },
    );
  }

  const state = createOAuthState(user.id, "google");
  return NextResponse.redirect(buildAuthorizeUrl(config, state));
}

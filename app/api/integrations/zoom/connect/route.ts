import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { buildAuthorizeUrl, getZoomConfig } from "@/lib/integrations/zoom";
import { createOAuthState } from "@/lib/integrations/oauth-state";

/**
 * GET /api/integrations/zoom/connect
 *
 * Zoom OAuth 認可フローを開始する。
 * 接続自体はアドオン契約不要(「会議予約」「会議作成」は無料機能)。
 * 「Cloud Recording の自動取り込み」だけがアドオン契約者限定の挙動として、
 * Webhook の ingest 経路で制御する(ここではゲートしない)。
 *
 * state は user_id + provider + ts を HMAC で署名して載せる(CSRF 対策)。
 * 完了後 /api/integrations/zoom/callback に code + state がコールバックされる。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

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

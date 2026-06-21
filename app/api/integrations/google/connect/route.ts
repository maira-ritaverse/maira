import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { buildAuthorizeUrl, getGoogleConfig } from "@/lib/integrations/google";
import { createOAuthState } from "@/lib/integrations/oauth-state";

/**
 * GET /api/integrations/google/connect
 *
 * Google OAuth 認可 フロー を 開始。 基本 機能 (Google Meet 会議 作成 等) は
 * 全 ユーザー に 開放 する。
 *
 * Google Drive 録音 自動 取込 機能 (= meeting_recording_auto アドオン) は
 * 別途 pickup cron 側 で hasAddon チェック を かける ことで 課金 ガード を
 * 維持 する。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

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

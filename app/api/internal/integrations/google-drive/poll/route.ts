import { NextResponse } from "next/server";

import { checkCronAuth } from "@/lib/api/cron-auth";
import { getGoogleAccessToken } from "@/lib/integrations/google-token";
import { pollGoogleDriveForMeetRecordings } from "@/lib/integrations/google-drive-meet";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET/POST /api/internal/integrations/google-drive/poll
 *
 * Vercel Cron から定期実行される、Google Drive ポーリングエンドポイント。
 * 認証は INTAKE_CRON_SECRET(Authorization Bearer / X-Cron-Secret)。
 *
 * 全ての接続中 google_connections に対して順次ポーリング → 新規 Meet 録画を
 * career_intake_recordings(external_pending)に enqueue → 既存 pickup
 * エンドポイントがそれを取り込んで Whisper + Claude を回す。
 *
 * 1 回の invocation で最大 N 件のユーザを処理する(残りは次のサイクル)。
 */

const MAX_USERS_PER_TICK = 5;

export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (!auth.ok) {
    if (auth.reason === "not_configured") {
      return NextResponse.json({ error: "CRON_SECRET 未設定" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  // last_drive_poll_at が古い順に処理
  const { data: connections } = await service
    .from("google_connections")
    .select("user_id, last_drive_poll_at")
    .order("last_drive_poll_at", { ascending: true, nullsFirst: true })
    .limit(MAX_USERS_PER_TICK);

  const results: Array<{ userId: string; result: unknown; error?: string }> = [];
  for (const conn of (connections ?? []) as Array<{
    user_id: string;
    last_drive_poll_at: string | null;
  }>) {
    try {
      const token = await getGoogleAccessToken({ service, userId: conn.user_id });
      const result = await pollGoogleDriveForMeetRecordings({
        service,
        userId: conn.user_id,
        accessToken: token.accessToken,
        sinceIso: conn.last_drive_poll_at,
      });
      results.push({ userId: conn.user_id, result });
    } catch (err) {
      results.push({
        userId: conn.user_id,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}

export const GET = POST;

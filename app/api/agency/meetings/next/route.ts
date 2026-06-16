/**
 * GET /api/agency/meetings/next
 *
 * 本人主催の「次の面談」を 1 件返す。
 * 「次の面談」ウィジェットが 60 秒ごとにポーリングする用途。
 *
 * - 開始まで 24 時間以内のもの 1 件のみ
 * - キャンセル / 過去 は除外
 */
import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getNextMeetingForHost } from "@/lib/meetings/queries";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  try {
    const meeting = await getNextMeetingForHost(supabase, user.id, { withinHours: 24 });
    return NextResponse.json({ meeting });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch_failed", message: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}

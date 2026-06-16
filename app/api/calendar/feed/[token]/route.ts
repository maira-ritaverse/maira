/**
 * GET /api/calendar/feed/[token]
 *
 * 公開 .ics フィード配信エンドポイント。
 * トークンを URL に含めるだけで誰でも取得できる(他のカレンダーアプリの仕様)。
 *
 * セキュリティ:
 *   ・トークンは秘密値だが「URL を知っている人は見られる」の前提
 *   ・revoked_at が NOT NULL なら 404 を返す
 *   ・トークンを照合 → user_id を取得 → service_role で予定を取得
 *
 * レスポンス:
 *   Content-Type: text/calendar; charset=utf-8
 *   Body: VCALENDAR 文字列
 */
import { NextResponse } from "next/server";

import { buildIcsFeed, defaultFeedRange, loadFeedSources } from "@/lib/calendar/feed";
import { createServiceClient } from "@/lib/supabase/service";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!token || token.length < 16) {
    return new NextResponse("not found", { status: 404 });
  }

  const service = createServiceClient();

  // 1) トークンを user に解決
  const { data: row } = await service
    .from("calendar_feed_tokens")
    .select("user_id, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (!row) {
    return new NextResponse("not found", { status: 404 });
  }
  const tokenRow = row as { user_id: string; revoked_at: string | null };
  if (tokenRow.revoked_at) {
    return new NextResponse("revoked", { status: 410 });
  }

  // 2) 範囲を確定して予定を取得
  const range = defaultFeedRange(new Date());
  const sources = await loadFeedSources(service, tokenRow.user_id, range);

  // 3) VCALENDAR を組み立て(now はサーバ時刻)
  const ics = buildIcsFeed(sources, new Date());

  // 4) last_accessed_at を更新(失敗しても本処理に影響させない)
  void service
    .from("calendar_feed_tokens")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("token", token)
    .then(() => undefined);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // 30 分キャッシュを許可(Google 側は最大 24h 程度のキャッシュ)
      "Cache-Control": "public, max-age=1800",
    },
  });
}

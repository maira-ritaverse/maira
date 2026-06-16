/**
 * GET    /api/me/calendar-feed-token  — 自分の購読 URL を取得(無ければ null)
 * POST   /api/me/calendar-feed-token  — 新規発行(既存があれば置き換え)
 * DELETE /api/me/calendar-feed-token  — 失効(revoked_at をセット)
 *
 * トークン生成:randomBytes(32) を base64url
 * 既存トークンを upsert で置き換える(別端末で見ても 1 つに統一)
 *
 * UPSERT は service_role 経由(RLS は SELECT/DELETE のみ許可)
 */
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { requireUser } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { createServiceClient } from "@/lib/supabase/service";

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function buildFeedUrl(token: string): string {
  return buildAbsoluteUrl(`/api/calendar/feed/${token}`);
}

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  const { data: row } = await supabase
    .from("calendar_feed_tokens")
    .select("token, revoked_at, last_accessed_at, created_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ feed: null });
  }
  const r = row as {
    token: string;
    revoked_at: string | null;
    last_accessed_at: string | null;
    created_at: string;
  };
  if (r.revoked_at) {
    return NextResponse.json({ feed: null });
  }
  return NextResponse.json({
    feed: {
      url: buildFeedUrl(r.token),
      lastAccessedAt: r.last_accessed_at,
      createdAt: r.created_at,
    },
  });
}

export async function POST() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const token = generateToken();
  const service = createServiceClient();
  const { error } = await service.from("calendar_feed_tokens").upsert(
    {
      user_id: user.id,
      token,
      revoked_at: null,
      last_accessed_at: null,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json(
      { error: "db_upsert_failed", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ feed: { url: buildFeedUrl(token) } }, { status: 201 });
}

export async function DELETE() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  // RLS で本人の行のみ削除可能なのでこのまま呼ぶ
  const { error } = await supabase.from("calendar_feed_tokens").delete().eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "db_delete_failed", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

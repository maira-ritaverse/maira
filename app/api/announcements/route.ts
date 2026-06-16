import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { listMyPlatformAnnouncements } from "@/lib/announcements/platform-queries";

/**
 * GET /api/announcements?unreadOnly=1
 *
 * 自分が見られる platform_announcements の一覧。
 * - unreadOnly=1 なら未読のみ
 * - pinned 先頭 + publishedAt 降順(RLS で公開期間 / 対象 org 内に絞り込み済)
 */
export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  try {
    const items = await listMyPlatformAnnouncements({
      includeRead: !unreadOnly,
    });
    return NextResponse.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "load_failed", message: msg }, { status: 500 });
  }
}

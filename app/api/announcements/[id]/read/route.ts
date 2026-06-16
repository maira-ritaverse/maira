import { NextResponse } from "next/server";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import { markPlatformAnnouncementRead } from "@/lib/announcements/platform-queries";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/announcements/[id]/read
 *
 * 自分の既読フラグを立てる。Body: { acknowledge?: boolean }
 * require_ack のお知らせは acknowledge=true を明示しないと「読了」と見なさない設計。
 */
export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const json = await readJsonBody(request);
  let acknowledge = false;
  if (json.ok && typeof json.body === "object" && json.body !== null) {
    const b = json.body as { acknowledge?: unknown };
    acknowledge = b.acknowledge === true;
  }

  try {
    await markPlatformAnnouncementRead({ announcementId: id, acknowledge });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "mark_read_failed", message: msg }, { status: 500 });
  }
}

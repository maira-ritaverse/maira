import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { deletePlatformAnnouncement, isMairaAdmin } from "@/lib/announcements/platform-queries";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/announcements/[id]
 * 運営者:お知らせ削除
 */
export async function DELETE(_: Request, { params }: RouteParams) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await deletePlatformAnnouncement(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "delete_failed", message: msg }, { status: 500 });
  }
}

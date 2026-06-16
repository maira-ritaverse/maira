import { NextResponse } from "next/server";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";
import {
  createPlatformAnnouncement,
  isMairaAdmin,
  listAllPlatformAnnouncementsForAdmin,
} from "@/lib/announcements/platform-queries";
import { createPlatformAnnouncementSchema } from "@/lib/announcements/platform-types";

/**
 * GET /api/admin/announcements
 *
 * 運営者向け:全件取得(公開期間外 / 期限切れも含む)。
 * is_maira_admin=false なら 403。
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const items = await listAllPlatformAnnouncementsForAdmin();
    return NextResponse.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "load_failed", message: msg }, { status: 500 });
  }
}

/**
 * POST /api/admin/announcements
 *
 * 運営者向け:お知らせ作成。
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = createPlatformAnnouncementSchema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const id = await createPlatformAnnouncement(parsed.data);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: "create_failed", message: msg }, { status: 500 });
  }
}

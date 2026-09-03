import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { deleteMeeting, getMeeting } from "@/lib/sales/queries";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * DELETE /api/admin/deals/[id]/meetings/[meetingId]
 * ミーティングを削除(音声ファイルも Storage から削除)。is_maira_admin 限定。
 */
type RouteParams = { params: Promise<{ id: string; meetingId: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { meetingId } = await params;

  const meeting = await getMeeting(meetingId);
  if (meeting?.storagePath) {
    const service = createServiceClient();
    // Storage 削除は失敗しても DB 行の削除は続行(孤立ファイルは無害)
    await service.storage.from("sales-meeting-audio").remove([meeting.storagePath]);
  }

  const result = await deleteMeeting(meetingId);
  if ("error" in result) {
    return NextResponse.json({ error: "delete_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

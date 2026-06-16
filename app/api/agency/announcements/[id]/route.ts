import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { updateAnnouncementSchema } from "@/lib/announcements/types";

/**
 * /api/agency/announcements/[id]
 *   PATCH  - 編集(admin)/ "markRead": true で自分の既読マーク(全メンバー)
 *   DELETE - 削除(admin)
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const memberGuard = await requireOrgMember();
  if (!memberGuard.ok) return memberGuard.response;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  // 既読マーク(全メンバー)
  if (typeof body === "object" && body !== null && (body as { markRead?: boolean }).markRead) {
    const { supabase, member } = memberGuard;
    const { error } = await supabase
      .from("announcement_reads")
      .upsert(
        { announcement_id: id, member_id: member.id, read_at: new Date().toISOString() },
        { onConflict: "announcement_id,member_id" },
      );
    if (error) {
      return NextResponse.json(
        { error: "Failed to mark read", message: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  }

  // それ以外の編集は admin のみ
  const adminGuard = await requireOrgAdmin();
  if (!adminGuard.ok) return adminGuard.response;
  const { supabase, organization } = adminGuard;

  const parsed = updateAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title.trim();
  if (parsed.data.body !== undefined) update.body = parsed.data.body;
  if (parsed.data.isPinned !== undefined) update.is_pinned = parsed.data.isPinned;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("announcements")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { error } = await supabase
    .from("announcements")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

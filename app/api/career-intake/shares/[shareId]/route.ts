import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";

/**
 * DELETE /api/career-intake/shares/[shareId]
 *
 * 共有リンクを失効(revoked_at をセット)。
 * 物理削除ではなく soft delete。監査目的で履歴を残す。
 */
type RouteParams = { params: Promise<{ shareId: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { shareId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const { error } = await supabase
    .from("career_intake_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId)
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json(
      { error: "Failed to revoke", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

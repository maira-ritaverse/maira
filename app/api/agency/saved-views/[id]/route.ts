import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

/**
 * DELETE /api/agency/saved-views/[id]
 *
 * 自分が保存したビューを削除する。
 * - RLS で user_id = auth.uid() を強制(他人のビューは行が見えず 0 件削除)。
 * - 念のため eq("user_id", user.id) も明示する(RLS 落とし防御)。
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("saved_views").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

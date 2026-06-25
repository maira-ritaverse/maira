/**
 * DELETE /api/agency/clients/[id]/collaborators/[memberId]
 *
 * 求職者 から 副 担当 を 外す。 admin / 主 担当 / 副 担当 本人 (= 自分 を 外す) のみ 可能。
 */
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id: clientRecordId, memberId: targetMemberId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 対象 求職者 を 取得 + 同 組織
  const { data: client, error: clientErr } = await supabase
    .from("client_records")
    .select("id, organization_id, assigned_member_id")
    .eq("id", clientRecordId)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (client.organization_id !== role.organization.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 権限 チェック: admin、 主 担当、 自分 を 外す のみ
  const isAdmin = role.member.role === "admin";
  const isPrimary = client.assigned_member_id === role.member.id;
  const isSelf = targetMemberId === role.member.id;
  if (!isAdmin && !isPrimary && !isSelf) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error: deleteError } = await supabase
    .from("client_record_collaborators")
    .delete()
    .eq("client_record_id", clientRecordId)
    .eq("member_id", targetMemberId);

  if (deleteError) {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

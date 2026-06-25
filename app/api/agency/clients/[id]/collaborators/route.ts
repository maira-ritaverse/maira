/**
 * POST /api/agency/clients/[id]/collaborators
 *
 * 求職者 に 副 担当 を 追加 する。 同 組織 の admin / 主 担当 / 副 担当 本人 (= 自薦)
 * が 操作 可能。 主 担当 を 副 担当 にも 追加 しよう と した 場合 は 400 で 拒否。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  memberId: z.string().uuid(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientRecordId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const targetMemberId = parsed.data.memberId;

  // 対象 求職者 を 取得 + 同 組織 + 主 担当 重複 チェック
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
  if (client.assigned_member_id === targetMemberId) {
    return NextResponse.json({ error: "already_primary_assignee" }, { status: 400 });
  }

  // 対象 メンバー が 同 組織 か 確認
  const { data: targetMember, error: targetErr } = await supabase
    .from("organization_members")
    .select("id, organization_id")
    .eq("id", targetMemberId)
    .single();
  if (targetErr || !targetMember || targetMember.organization_id !== role.organization.id) {
    return NextResponse.json({ error: "member_not_in_org" }, { status: 400 });
  }

  // 権限 チェック: admin、 主 担当、 副 担当 本人 (自薦) のみ
  const isAdmin = role.member.role === "admin";
  const isPrimary = client.assigned_member_id === role.member.id;
  const isSelf = targetMemberId === role.member.id;
  if (!isAdmin && !isPrimary && !isSelf) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error: insertError } = await supabase.from("client_record_collaborators").insert({
    client_record_id: clientRecordId,
    member_id: targetMemberId,
    added_by_member_id: role.member.id,
  });

  if (insertError) {
    // unique 制約 違反 = 既に 副 担当
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "already_collaborator" }, { status: 409 });
    }
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

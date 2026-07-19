import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { createAgencyTaskRequestSchema } from "@/lib/agency-tasks/types";

/**
 * POST /api/agency/tasks
 *
 * エージェント業務タスクを1件作成する。
 * - 認証 + organization_member ガード
 * - client_record_id / referral_id / assigned_member_id がいずれも自社のものか検証
 *   (referrals / interactions API と同じ二重防御)
 * - status はDBデフォルト 'pending' に任せる(API では受け取らない)
 *
 * ⚠️ /api/tasks(求職者向け、暗号化タスク)とは別ルート。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createAgencyTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { client_record_id, referral_id, assigned_member_id, title, priority, due_at } =
    parsed.data;
  const orgId = role.organization.id;

  // クライアントが自社か検証
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("organization_id")
    .eq("id", client_record_id)
    .maybeSingle();

  if (!clientRow || clientRow.organization_id !== orgId) {
    return NextResponse.json({ error: "Client not found in your organization" }, { status: 404 });
  }

  // 担当メンバーが自社の組織メンバーか検証
  // (RLS バイパスではないので、他社のメンバーIDを入れても自社で見えなければ通らない)
  const { data: memberRow } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("id", assigned_member_id)
    // soft delete された メンバー は 担当 に 割り当て 不可
    .is("removed_at", null)
    .maybeSingle();

  if (!memberRow || memberRow.organization_id !== orgId) {
    return NextResponse.json({ error: "Assignee not found in your organization" }, { status: 404 });
  }

  // referral_id が指定されていれば、自社かつ同じクライアントの紹介か検証
  if (referral_id) {
    const { data: referralRow } = await supabase
      .from("referrals")
      .select("organization_id, client_record_id")
      .eq("id", referral_id)
      .maybeSingle();

    if (
      !referralRow ||
      referralRow.organization_id !== orgId ||
      referralRow.client_record_id !== client_record_id
    ) {
      return NextResponse.json(
        { error: "Referral not found or does not match the client" },
        { status: 404 },
      );
    }
  }

  const { data, error } = await supabase
    .from("agency_tasks")
    .insert({
      organization_id: orgId,
      client_record_id,
      referral_id: referral_id ?? null,
      assigned_member_id,
      // タスク を 振った 側 (delegator)。 assigned_member_id は 受け取る 側 で
      // 同 一 の こと も あれば 他人 に 振った こと も ある。 チーム リード 行動
      // の 評価 (Phase 2) に 使用。
      created_by_member_id: role.member.id,
      title,
      priority: priority ?? null,
      due_at: due_at ?? null,
      // status はDBデフォルト 'pending' に任せる
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create task", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, success: true });
}

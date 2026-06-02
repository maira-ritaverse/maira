import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { updateInteractionRequestSchema } from "@/lib/interactions/types";

/**
 * PATCH /api/agency/interactions/[id]
 * DELETE /api/agency/interactions/[id]
 *
 * 対応履歴の編集・削除。
 * - PATCH: 同 organization のメンバーなら誰でも更新可(RLS と同じ方針)
 * - DELETE: 管理者(admin)のみ削除可(RLS でも DELETE は admin 限定だが、
 *   API 層でも明示的に弾いて分かりやすいエラーを返す)
 * - どちらも organization_id でも明示的に絞って二重防御
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateInteractionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.interaction_type !== undefined) updateData.interaction_type = d.interaction_type;
  if (d.occurred_at !== undefined) updateData.occurred_at = d.occurred_at;
  if (d.summary !== undefined) updateData.summary = d.summary || null;
  if (d.body !== undefined) updateData.body = d.body || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("client_interactions")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", role.organization.id);

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

  // 削除は admin のみ(RLS でも弾けるが、API 層で明示的に 403 を返す)
  if (role.member.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden", message: "対応履歴の削除は管理者のみ可能です" },
      { status: 403 },
    );
  }

  const { error } = await supabase
    .from("client_interactions")
    .delete()
    .eq("id", id)
    .eq("organization_id", role.organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

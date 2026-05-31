import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { updateClientRequestSchema } from "@/lib/clients/types";

/**
 * PATCH /api/agency/clients/[id]
 *
 * クライアントレコードを部分更新する。
 * - 認証 + organization_member ガード
 * - RLS により自社のクライアントのみ更新可能。念のため organization_id でも絞る
 *   (RLS が外れた場合の二重防御)。
 * - link_status/linked_user_id/linked_at/revoked_at は別フロー(連携承諾フロー)で
 *   更新するため、ここでは触らない。
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

  const parsed = updateClientRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // undefined のフィールドは更新対象に含めない(部分更新)
  const updateData: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.name !== undefined) updateData.name = d.name;
  if (d.email !== undefined) updateData.email = d.email;
  if (d.phone !== undefined) updateData.phone = d.phone || null;
  if (d.status !== undefined) updateData.status = d.status;
  if (d.assigned_member_id !== undefined) updateData.assigned_member_id = d.assigned_member_id;
  if (d.notes !== undefined) updateData.notes = d.notes || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("client_records")
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

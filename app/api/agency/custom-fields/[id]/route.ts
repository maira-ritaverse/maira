import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { updateCustomFieldSchema } from "@/lib/custom-fields/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateCustomFieldSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) update.label = parsed.data.label.trim();
  if (parsed.data.fieldType !== undefined) update.field_type = parsed.data.fieldType;
  if (parsed.data.options !== undefined) update.options = parsed.data.options;
  if (parsed.data.isRequired !== undefined) update.is_required = parsed.data.isRequired;
  if (parsed.data.displayOrder !== undefined) update.display_order = parsed.data.displayOrder;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { error } = await supabase
    .from("client_custom_field_definitions")
    .update(update)
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
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // 定義を削除しても client_records.custom_fields の JSON 自体は残る(ノイズ)。
  // 表示時に「未知のキー」は無視するので実害なし。完全クリーンアップは別 RPC を用意する余地あり。
  const { error } = await supabase
    .from("client_custom_field_definitions")
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

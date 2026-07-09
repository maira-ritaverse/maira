/**
 * PATCH / DELETE /api/agency/interviews/[id]
 *
 * 面接 の 部分 更新 (主 に result 変更 「1 次 通過 = done」) と 削除。
 * RLS で 自 組織 の レコード のみ 更新 / 削除 可。
 */
import { NextResponse } from "next/server";

import { updateInterviewRequestSchema } from "@/lib/interviews/types";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = updateInterviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (d.kind !== undefined) updateData.kind = d.kind;
  if (d.scheduled_at !== undefined) updateData.scheduled_at = d.scheduled_at;
  if (d.result !== undefined) updateData.result = d.result;
  if (d.notes !== undefined) updateData.notes = d.notes;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("interviews")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", role.organization.id);

  if (error) {
    return NextResponse.json(
      { error: "更新 に 失敗 しま した", details: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

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

  const { error } = await supabase
    .from("interviews")
    .delete()
    .eq("id", id)
    .eq("organization_id", role.organization.id);

  if (error) {
    return NextResponse.json(
      { error: "削除 に 失敗 しま した", details: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { deleteProspect, updateProspect } from "@/lib/sales/queries";
import { updateProspectSchema } from "@/lib/sales/types";

/**
 * /api/admin/deals/[id]
 *   PATCH  - 商談の更新(ステージ / 会社情報 / メモ)。is_maira_admin 限定
 *   DELETE - 商談の削除(ミーティングは cascade で削除)
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = updateProspectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await updateProspect(id, parsed.data);
  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "update_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await deleteProspect(id);
  if ("error" in result) {
    return NextResponse.json({ error: "delete_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

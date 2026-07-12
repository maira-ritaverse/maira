/**
 * PATCH  /api/agency/forms/[id]   :フォーム更新(タイトル / 質問 / 公開状態)
 * DELETE /api/agency/forms/[id]   :フォーム削除(送信履歴は cascade)
 *
 * organization_admin のみ。RLS を通して自組織の form しか触れないよう二重防御。
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { UpdateFormRequestSchema } from "@/lib/forms/types";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const { id: formId } = await context.params;
  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = UpdateFormRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.schema_json !== undefined) patch.schema_json = parsed.data.schema_json;
  if (parsed.data.is_published !== undefined) patch.is_published = parsed.data.is_published;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("forms")
    .update(patch)
    .eq("id", formId)
    .eq("organization_id", guard.organization.id);

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const { id: formId } = await context.params;
  const admin = createServiceClient();
  const { error } = await admin
    .from("forms")
    .delete()
    .eq("id", formId)
    .eq("organization_id", guard.organization.id);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

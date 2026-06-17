import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin } from "@/lib/api/auth-guards";
import {
  rowToRecommendationLetterTemplate,
  updateRecommendationLetterTemplateSchema,
  type RecommendationLetterTemplateRow,
} from "@/lib/recommendation-letters/types";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * /api/agency/recommendation-letter-templates/[id]
 *   PATCH  - 部分更新(admin 限定)。name 衝突は 409。
 *   DELETE - 削除(admin 限定)。RLS でも保証されているが API でも明示的に弾く。
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = updateRecommendationLetterTemplateSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
  if (parsed.data.prefix_body !== undefined) update.prefix_body = parsed.data.prefix_body;
  if (parsed.data.suffix_body !== undefined) update.suffix_body = parsed.data.suffix_body;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { data, error } = await supabase
    .from("recommendation_letter_templates")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id)
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "同じ名前のテンプレートが既に存在します" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    template: rowToRecommendationLetterTemplate(data as RecommendationLetterTemplateRow),
  });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { error } = await supabase
    .from("recommendation_letter_templates")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

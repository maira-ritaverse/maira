import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import {
  createRecommendationLetterTemplateSchema,
  rowToRecommendationLetterTemplate,
  type RecommendationLetterTemplateRow,
} from "@/lib/recommendation-letters/types";

/**
 * /api/agency/recommendation-letter-templates
 *   GET   - 組織のテンプレ一覧(更新日時降順)。組織メンバーなら誰でも閲覧可。
 *   POST  - 新規作成(admin 限定)。同名(organization_id, name)は 23505 → 409。
 *
 * email-templates と同じパターン。テンプレ本体は平文(prefix_body / suffix_body)。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { data, error } = await supabase
    .from("recommendation_letter_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load", message: error.message }, { status: 500 });
  }

  const templates = ((data ?? []) as RecommendationLetterTemplateRow[]).map(
    rowToRecommendationLetterTemplate,
  );
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createRecommendationLetterTemplateSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("recommendation_letter_templates")
    .insert({
      organization_id: organization.id,
      name: parsed.data.name.trim(),
      prefix_body: parsed.data.prefix_body,
      suffix_body: parsed.data.suffix_body,
      created_by_member_id: member.id,
    })
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
      { error: "Failed to create", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      template: rowToRecommendationLetterTemplate(data as RecommendationLetterTemplateRow),
    },
    { status: 201 },
  );
}

import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { createEmailTemplateSchema, rowToEmailTemplate } from "@/lib/email-templates/templates";

/**
 * /api/agency/email-templates
 *   GET   - 組織のメールテンプレ一覧(更新日時降順)
 *   POST  - 新規作成(admin 限定)
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .eq("organization_id", organization.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load", message: error.message }, { status: 500 });
  }
  const templates = ((data ?? []) as Parameters<typeof rowToEmailTemplate>[0][]).map(
    rowToEmailTemplate,
  );
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createEmailTemplateSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      organization_id: organization.id,
      name: parsed.data.name.trim(),
      subject: parsed.data.subject,
      body: parsed.data.body,
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
      template: rowToEmailTemplate(data as Parameters<typeof rowToEmailTemplate>[0]),
    },
    { status: 201 },
  );
}

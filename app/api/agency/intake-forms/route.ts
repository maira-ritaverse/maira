import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { createIntakeFormSchema, rowToIntakeForm } from "@/lib/intake-forms/types";

/**
 * /api/agency/intake-forms
 *   GET  - 組織のフォーム一覧
 *   POST - 新規作成(admin 限定)
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { data, error } = await supabase
    .from("intake_forms")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "Failed to load", message: error.message }, { status: 500 });
  }
  const forms = ((data ?? []) as Parameters<typeof rowToIntakeForm>[0][]).map(rowToIntakeForm);
  return NextResponse.json({ forms });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization, member } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createIntakeFormSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("intake_forms")
    .insert({
      organization_id: organization.id,
      name: parsed.data.name.trim(),
      entry_site: parsed.data.entrySite ?? null,
      created_by_member_id: member.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { form: rowToIntakeForm(data as Parameters<typeof rowToIntakeForm>[0]) },
    { status: 201 },
  );
}

import { NextResponse } from "next/server";

import { readJsonBody, requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { createCustomFieldSchema, rowToCustomFieldDefinition } from "@/lib/custom-fields/types";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { data, error } = await supabase
    .from("client_custom_field_definitions")
    .select("*")
    .eq("organization_id", organization.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load", message: error.message }, { status: 500 });
  }
  const fields = ((data ?? []) as Parameters<typeof rowToCustomFieldDefinition>[0][]).map(
    rowToCustomFieldDefinition,
  );
  return NextResponse.json({ fields });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = createCustomFieldSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  if (parsed.data.fieldType === "select" && parsed.data.options.length === 0) {
    return NextResponse.json(
      { error: "select 型は選択肢を 1 つ以上指定してください" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("client_custom_field_definitions")
    .insert({
      organization_id: organization.id,
      key: parsed.data.key,
      label: parsed.data.label.trim(),
      field_type: parsed.data.fieldType,
      options: parsed.data.options,
      is_required: parsed.data.isRequired,
      display_order: parsed.data.displayOrder,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "同じ key のフィールドが既に存在します" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Failed to create", message: error?.message ?? "Unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { field: rowToCustomFieldDefinition(data as Parameters<typeof rowToCustomFieldDefinition>[0]) },
    { status: 201 },
  );
}

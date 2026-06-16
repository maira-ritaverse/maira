import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { rowToEmailTemplate, updateEmailTemplateSchema } from "@/lib/email-templates/templates";

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

  const parsed = updateEmailTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name.trim();
  if (parsed.data.subject !== undefined) update.subject = parsed.data.subject;
  if (parsed.data.body !== undefined) update.body = parsed.data.body;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true });
  }

  const { data, error } = await supabase
    .from("email_templates")
    .update(update)
    .eq("id", id)
    .eq("organization_id", role.organization.id)
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
    template: rowToEmailTemplate(data as Parameters<typeof rowToEmailTemplate>[0]),
  });
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

  const { error } = await supabase
    .from("email_templates")
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

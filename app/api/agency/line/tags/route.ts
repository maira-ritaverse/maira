import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/agency/line/tags
 * 組織 の 全 タグ 一覧。
 *
 * POST /api/agency/line/tags
 * タグ 新規作成 (admin / advisor 両方 可)。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("line_conversation_tags")
    .select("id, name, color, created_at")
    .order("name", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ tags: data ?? [] });
}

const postBody = z.object({
  name: z.string().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("line_conversation_tags")
    .insert({
      organization_id: guard.organization.id,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
    })
    .select("id, name, color, created_at")
    .single();
  if (error) {
    // 重複 (unique 違反)
    if (error.code === "23505") {
      return NextResponse.json({ error: "name_already_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tag: data });
}

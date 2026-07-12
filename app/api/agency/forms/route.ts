/**
 * GET  /api/agency/forms       :自組織のフォーム一覧
 * POST /api/agency/forms       :新規フォーム作成
 *
 * ・organization_member 以上で GET、organization_admin で POST
 * ・public_token はサーバ側で crypto.randomUUID + base62 相当のトークンを生成
 */
import { NextResponse } from "next/server";

import { requireOrgAdmin, requireOrgMember } from "@/lib/api/auth-guards";
import { CreateFormRequestSchema } from "@/lib/forms/types";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** URL 安全な 24 文字のトークン(衝突は unique index で担保) */
function makePublicToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data } = await guard.supabase
    .from("forms")
    .select("id, title, description, public_token, is_published, schema_json, updated_at")
    .eq("organization_id", guard.organization.id)
    .order("updated_at", { ascending: false });

  return NextResponse.json({ forms: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = CreateFormRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("forms")
    .insert({
      organization_id: guard.organization.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      public_token: makePublicToken(),
      schema_json: [],
      created_by: guard.user.id,
    })
    .select("id, public_token")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id, public_token: data.public_token });
}

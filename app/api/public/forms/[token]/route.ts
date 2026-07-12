/**
 * GET /api/public/forms/[token]
 *
 * 公開フォームの表示用データを返す(質問リスト + タイトル)。
 * 認証なし。is_published=true のフォームのみ返す。
 */
import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!token || token.length > 80) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data } = await admin
    .from("forms")
    .select("id, title, description, schema_json, is_published, organization_id")
    .eq("public_token", token)
    .maybeSingle();

  if (!data || !(data as { is_published: boolean }).is_published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row = data as {
    id: string;
    title: string;
    description: string | null;
    schema_json: unknown;
  };

  return NextResponse.json({
    form: {
      id: row.id,
      title: row.title,
      description: row.description,
      schema_json: row.schema_json,
    },
  });
}

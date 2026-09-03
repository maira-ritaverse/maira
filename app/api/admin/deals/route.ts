import { NextResponse } from "next/server";

import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { createProspect, listProspects } from "@/lib/sales/queries";
import { createProspectSchema } from "@/lib/sales/types";
import { createClient } from "@/lib/supabase/server";

/**
 * /api/admin/deals
 *   GET  - 商談一覧(is_maira_admin 限定)
 *   POST - 商談を新規作成
 *
 * /admin/* レイアウトでも isMairaAdmin ガード済みだが、API では明示的に二重ガードする。
 */
export async function GET() {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const prospects = await listProspects();
  return NextResponse.json({ prospects });
}

export async function POST(request: Request) {
  if (!(await isMairaAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // owner_user_id 用に現在の運営ユーザー ID を取得
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = createProspectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const result = await createProspect(parsed.data, user.id);
  if ("error" in result) {
    return NextResponse.json({ error: "create_failed", message: result.error }, { status: 500 });
  }
  return NextResponse.json({ prospect: result }, { status: 201 });
}

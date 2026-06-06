import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCv } from "@/lib/cvs/queries";
import { saveCvRequestSchema } from "@/lib/cvs/types";

/**
 * 職務経歴書 新規作成 API
 *
 * POST /api/cvs
 * - 認証チェック
 * - saveCvRequestSchema でバリデーション
 * - user_id は auth.uid()(本人のみ)
 * - 戻り値:作成した cv の id
 *
 * 暗号化は queries 層(createCv)で透過的に行われる。ルート層は body をそのまま渡す。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = saveCvRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const id = await createCv(user.id, parsed.data);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to create",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}

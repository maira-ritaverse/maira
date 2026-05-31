import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createResume } from "@/lib/resumes/queries";
import { saveResumeRequestSchema } from "@/lib/resumes/types";

/**
 * 履歴書 新規作成 API
 *
 * POST /api/resumes
 * - 認証チェック
 * - saveResumeRequestSchema でバリデーション
 * - user_id は auth.uid()(本人のみ)
 * - 戻り値:作成した resume の id
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

  const parsed = saveResumeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const id = await createResume(user.id, parsed.data);
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

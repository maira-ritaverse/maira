import { NextResponse } from "next/server";
import { saveDiagnosisResult } from "@/lib/career/conversations";
import { diagnosisSchema } from "@/lib/career/profile-schema";
import { createClient } from "@/lib/supabase/server";

/**
 * 診断結果を career_profile に保存する API
 *
 * - 認証必須(auth.uid() で保存対象を決定する)
 * - 入力は diagnosisSchema(profile-schema 側で定義)で厳密検証
 * - 保存ロジックは saveDiagnosisResult に委譲(既存 profile があれば diagnosis のみ差し替え)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = diagnosisSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await saveDiagnosisResult(user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Diagnosis save error:", error);
    return NextResponse.json({ error: "Failed to save diagnosis" }, { status: 500 });
  }
}

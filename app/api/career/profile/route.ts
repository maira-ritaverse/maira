import { NextResponse } from "next/server";
import { saveCareerProfile } from "@/lib/career/conversations";
import { careerProfileSchema } from "@/lib/career/profile-schema";
import { createClient } from "@/lib/supabase/server";

/**
 * キャリア棚卸し結果(career_profile)の手動編集 API
 *
 * 生成系 API(/api/career/generate-profile)とは別経路で、
 * ユーザーが UI から各フィールドを手で更新した内容を保存する。
 *
 * フロー:
 * 1. 認証チェック
 * 2. リクエストを careerProfileSchema(diagnosis を omit)で検証
 *    → 編集 UI には diagnosis フィールドを出さない方針のため
 * 3. saveCareerProfile に委譲
 *    → 既存レコードに diagnosis があれば、関数内のマージで自動的に引き継がれる
 *      (lib/career/conversations.ts:218-224)
 *    → 編集側で diagnosis を一切扱わないので、再診断結果を壊さない
 *
 * 暗号化:
 * - saveCareerProfile が現状の bytea 暫定方式に従う。
 *   編集 API 側で独自に encrypt/decrypt は行わない(Week 3 で一括置換)。
 */

// 編集が触れるのは棚卸し本体のみ。diagnosis はキャリア診断ページから別経路で更新する。
const editableProfileSchema = careerProfileSchema.omit({ diagnosis: true });

export async function PATCH(request: Request) {
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

  const parsed = editableProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    // diagnosis フィールドは渡さない。saveCareerProfile が既存値をマージして保護する。
    await saveCareerProfile(user.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Career profile update error:", error);
    return NextResponse.json({ error: "Failed to update career profile" }, { status: 500 });
  }
}

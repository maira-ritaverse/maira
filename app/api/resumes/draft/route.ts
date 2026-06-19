import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCareerProfile } from "@/lib/career/conversations";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import { buildResumeDraftPrompt } from "@/lib/ai/prompts/resume-draft";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { createClient } from "@/lib/supabase/server";

/**
 * 履歴書「自由記述欄」のAI下書き生成API
 *
 * 履歴書フォームの以下2欄に対して、AI による下書きを返す:
 * - motivation: 志望の動機・特技・アピールポイント
 * - personal_requests: 本人希望記入欄
 *
 * フロー:
 * 1. 認証チェック
 * 2. リクエスト(field)のバリデーション
 * 3. ユーザーの career_profile を取得(なければ400で「先に棚卸しを」を返す)
 * 4. field に応じてプロンプトを切り替え、Anthropic API で生成
 * 5. 生成テキストを返す(DBには保存しない:履歴書はフォーム保存で別に保存される)
 *
 * 注意:
 * - 「事実」(資格・学歴・職歴など)を AI に創作させないよう、
 *   プロンプト側で career_profile に無い情報の創作を厳しく禁じている
 * - 書類生成 API(/api/documents/generate)と違い、こちらは履歴書フォーム
 *   への一時的な下書き挿入が目的なので messages テーブルへの保存はしない
 */

const draftRequestSchema = z.object({
  field: z.enum(["motivation", "personal_requests"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // リクエストのパース
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = draftRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { field } = parsed.data;

  // 月次 AI 下書き 上限 (履歴書系: 月 20 回 ハード)
  const usage = await checkAiUsageLimit(supabase, user.id, "seeker_resume_ai_draft");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "quota_exceeded",
        message: `今月の 履歴書 AI 下書き 枠 (${usage.limit} 回) を 使い切りました。 翌月 1 日に リセット されます。`,
        current: usage.current,
        limit: usage.limit,
      },
      { status: 429 },
    );
  }

  // career_profile を取得(下書き生成の元データ)
  const profileData = await getCareerProfile(user.id);
  if (!profileData) {
    // フロントは status=400 + code="no_career_profile" で「棚卸しへの導線」を出す
    return NextResponse.json(
      {
        error: "No career profile",
        code: "no_career_profile",
        message: "先にキャリア棚卸しを完了してください。棚卸し結果を元に下書きを作成します。",
      },
      { status: 400 },
    );
  }

  try {
    const { system, prompt } = buildResumeDraftPrompt({
      field,
      profile: profileData.profile,
    });

    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
    });

    // 利用ログ (失敗 しても 本処理 は 止めない)
    await recordAiUsage(supabase, user.id, "seeker_resume_ai_draft", { field });

    return NextResponse.json({
      field,
      content: result.text,
    });
  } catch (error) {
    console.error("Resume draft generation error:", error);

    const info = categorizeAIError(error);
    return NextResponse.json(
      {
        error: "Failed to generate draft",
        message: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}

// 下書き生成は数秒〜数十秒。書類生成ほど長くはないが、念のため余裕を持たせる
export const maxDuration = 60;

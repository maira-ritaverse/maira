import { generateObject, generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCareerProfile } from "@/lib/career/conversations";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import {
  buildCvDraftPrompt,
  skillCandidatesSchema,
  workExperienceDraftSchema,
} from "@/lib/ai/prompts/cv-draft";
import { workExperienceSchema } from "@/lib/cvs/types";
import { createClient } from "@/lib/supabase/server";

/**
 * 職務経歴書「自由記述欄」のAI下書き生成API
 *
 * Phase 4-a で:
 * - summary: 職務要約
 * - self_pr: 自己PR
 *
 * Phase 4-b で:
 * - work_experience: 各職歴の「業務内容」「実績・成果」(行ごと、事実を入力に取る)
 *
 * Phase 4-c で(このコミット):
 * - skills: 棚卸しの強みからスキル候補を抽出して返す
 *   (ユーザーがチェックで採択する前提のため、API は候補リストを返すだけ)
 *
 * フロー(履歴書 draft API と同型):
 * 1. 認証チェック
 * 2. リクエスト(field)のバリデーション
 * 3. ユーザーの career_profile を取得(なければ400 + code="no_career_profile")
 * 4. field に応じてプロンプトを切り替え、Anthropic API で生成
 *    - summary / self_pr: generateText(自由文章)
 *    - work_experience: generateObject({ job_description, achievements })
 *    - skills: generateObject({ candidates: Skill[] })
 * 5. 生成結果を返す(DBには保存しない:CV はフォーム保存で別に保存される)
 *
 * 注意:
 * - 「事実」(会社名・期間・役職・資格など)を AI に創作させないよう、
 *   プロンプト側で career_profile に無い情報の創作を厳しく禁じている
 * - work_experience は事実(会社名等)が無いと生成できないので、
 *   workExperienceSchema(company_name 必須)でリクエストを弾く
 * - 書類生成 API(/api/documents/generate)と違い、こちらは CV フォームへの
 *   一時的な下書き挿入が目的なので messages テーブルへの保存はしない
 *   (履歴書 draft と同じ設計)
 */

// Phase 4-a の summary / self_pr、4-b の work_experience、4-c の skills を全部含む。
// skills は追加入力なし(career_profile.strengths のみが材料なので、
// フィールド名だけ送ればよい)。
const draftRequestSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("summary") }),
  z.object({ field: z.literal("self_pr") }),
  z.object({
    field: z.literal("work_experience"),
    // workExperienceSchema 側で company_name 必須(min(1))を強制している。
    // → 事実(会社名)が無い行で生成しようとした場合、ここで 400 にして弾く。
    workExperience: workExperienceSchema,
    // どの行に setValue で戻すかフォームに教えるための echo 用。
    // サーバーでは使わず、レスポンスにそのまま含めて返す。
    index: z.number().int().min(0),
  }),
  z.object({ field: z.literal("skills") }),
]);

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
    // skills は構造化(Skill 配列)なので generateObject。candidates キーで返す。
    if (parsed.data.field === "skills") {
      const { system, prompt } = buildCvDraftPrompt({
        field: "skills",
        profile: profileData.profile,
      });

      const result = await generateObject({
        model: getModel(MODELS.CONVERSATION),
        schema: skillCandidatesSchema,
        system,
        prompt,
      });

      return NextResponse.json({
        field: "skills",
        candidates: result.object.candidates,
      });
    }

    // work_experience は出力が {job_description, achievements} の構造化データ
    // なので generateObject を使う。summary / self_pr は自由文章なので generateText。
    if (parsed.data.field === "work_experience") {
      const { system, prompt } = buildCvDraftPrompt({
        field: "work_experience",
        profile: profileData.profile,
        workExperience: parsed.data.workExperience,
      });

      const result = await generateObject({
        model: getModel(MODELS.CONVERSATION),
        schema: workExperienceDraftSchema,
        system,
        prompt,
      });

      return NextResponse.json({
        field: "work_experience",
        content: result.object,
        index: parsed.data.index,
      });
    }

    // summary / self_pr(自由文章)
    const { system, prompt } = buildCvDraftPrompt({
      field: parsed.data.field,
      profile: profileData.profile,
    });

    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
    });

    return NextResponse.json({
      field: parsed.data.field,
      content: result.text,
    });
  } catch (error) {
    console.error("CV draft generation error:", error);

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

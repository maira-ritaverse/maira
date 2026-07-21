import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import { recordAnthropic429Event } from "@/lib/ai/rate-limit-monitor";
import { CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT } from "@/lib/ai/prompts/career-profile-generator";
import { careerProfileSchema } from "@/lib/career/profile-schema";
import {
  getMessages,
  saveCareerProfile,
  verifyConversationOwner,
} from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";

/**
 * キャリア棚卸し結果の生成API
 *
 * フロー:
 * 1. 認証チェック
 * 2. conversationId の所有者確認(RLSと二重防御)
 * 3. 会話履歴をDBから取得
 * 4. generateObject で構造化JSONを生成(Zodで型保証)
 * 5. career_profiles に保存(upsert、version インクリメント)
 * 6. 結果を返す
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { conversationId?: string };
  const { conversationId } = body;

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const isOwner = await verifyConversationOwner(conversationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 会話履歴を取得
  const messages = await getMessages(conversationId);

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages in conversation" }, { status: 400 });
  }

  // 会話をテキスト化(AI に渡す形式)
  // "(セッション開始)" は内部用ダミーなので除外
  const conversationText = messages
    .filter((m) => !(m.role === "user" && m.content === "(セッション開始)"))
    .map((m) => {
      const speaker = m.role === "user" ? "ユーザー" : "Myaira";
      return `${speaker}: ${m.content}`;
    })
    .join("\n\n");

  try {
    // generateObject で構造化JSON生成
    // streamObject ではなく generateObject を使うのは、最終JSON以外不要でストリームの利点がないため
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: careerProfileSchema,
      system: CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT,
      prompt: `以下はユーザーとMyairaの会話履歴です。この会話から、ユーザーのキャリア棚卸し結果を構造化されたデータとして抽出してください。

【会話履歴】
${conversationText}`,
    });

    // DBに保存(同一ユーザーで既存があれば version をインクリメントして上書き)
    await saveCareerProfile(user.id, result.object);

    return NextResponse.json({ profile: result.object });
  } catch (error) {
    console.error("Profile generation error:", error);

    // categorizeAIError で エラー を 分類 し、 ユーザー 向け 文言 と HTTP ステータス を 統一
    const info = categorizeAIError(error);
    if (info.category === "rate_limit") void recordAnthropic429Event();
    return NextResponse.json(
      {
        error: "Failed to generate profile",
        message: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}

// generateObject は 30秒〜1分かかり得るので Next.js のデフォルトタイムアウトを延長
export const maxDuration = 120;

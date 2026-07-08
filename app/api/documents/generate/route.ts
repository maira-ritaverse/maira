import { generateText } from "ai";
import { NextResponse } from "next/server";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import { recordAnthropic429Event } from "@/lib/ai/rate-limit-monitor";
import { buildDocumentPrompt } from "@/lib/ai/prompts/document-writer";
import { generateDocumentRequestSchema, requiresJobInfo } from "@/lib/documents/types";
import { createClient } from "@/lib/supabase/server";
import { getCareerProfile, saveMessage } from "@/lib/career/conversations";
import { createDocumentConversation } from "@/lib/documents/conversations";

/**
 * 書類生成API
 *
 * フロー:
 * 1. 認証チェック
 * 2. リクエストのバリデーション(Zod)
 * 3. career_profile を取得(なければ「先に棚卸しを完了させて」と返す)
 * 4. 書類タイプ別のプロンプトを構築
 * 5. generateText で書類を一括生成(ストリーミングなし)
 * 6. conversations と messages に保存
 * 7. conversationId と本文を返す → UI が /app/documents/[id] に遷移する想定
 *
 * 注意:
 * - generateObject ではなく generateText を使うのは、書類は自由記述の
 *   文章であり、構造化JSONで縛る必要がないため。
 * - 暗号化は Week 3 で本実装。現状は saveMessage の暫定実装に乗る。
 */
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

  const parseResult = generateDocumentRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parseResult.error.format() },
      { status: 400 },
    );
  }

  const { type, jobInfo, customInstructions } = parseResult.data;

  // 求人情報が必須なタイプで未指定の場合は弾く
  if (requiresJobInfo(type) && !jobInfo) {
    return NextResponse.json(
      { error: "Job info is required for this document type" },
      { status: 400 },
    );
  }

  // career_profile を取得(これが書類生成の元データ)
  const profileData = await getCareerProfile(user.id);
  if (!profileData) {
    return NextResponse.json(
      {
        error: "No career profile",
        message: "先にキャリア棚卸し→「結果を生成」を行ってください",
      },
      { status: 400 },
    );
  }

  try {
    // プロンプト構築(system にタイプ別指示、prompt にデータ)
    const { system, prompt } = buildDocumentPrompt({
      type,
      profile: profileData.profile,
      jobInfo,
      customInstructions,
    });

    // 書類を生成(ストリーミングは使わない)
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system,
      prompt,
    });

    // 生成成功してから conversation を作る(失敗時に空の conversation が
    // 残らないようにするため)
    const conversationId = await createDocumentConversation({
      userId: user.id,
      documentType: type,
      jobInfo,
    });

    // 生成結果を assistant メッセージとして保存(これが書類本文)
    await saveMessage({
      conversationId,
      userId: user.id,
      role: "assistant",
      content: result.text,
      modelUsed: MODELS.CONVERSATION,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    });

    return NextResponse.json({
      conversationId,
      type,
      content: result.text,
    });
  } catch (error) {
    console.error("Document generation error:", error);

    // categorizeAIError でエラーを分類し、 ユーザー 向け 文言 と HTTP ステータス を 統一
    const info = categorizeAIError(error);
    if (info.category === "rate_limit") void recordAnthropic429Event();
    return NextResponse.json(
      {
        error: "Failed to generate document",
        message: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}

// 書類生成は数十秒〜1分かかり得るので Next.js のデフォルトタイムアウトを延長
export const maxDuration = 120;

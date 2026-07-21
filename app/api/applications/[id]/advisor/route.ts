import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { getModel, MODELS } from "@/lib/ai/client";
import { logAiStreamError } from "@/lib/ai/rate-limit-monitor";
import {
  APPLICATION_ADVISOR_SYSTEM_PROMPT,
  buildAdvisorContext,
} from "@/lib/ai/prompts/application-advisor";
import { getApplication, verifyApplicationOwner } from "@/lib/applications/queries";
import { getCareerProfile, saveMessage } from "@/lib/career/conversations";
import { createClient } from "@/lib/supabase/server";
import { listTasksByApplication } from "@/lib/tasks/queries";

/**
 * 応募アドバイザーAIへのチャットストリーミング
 *
 * フロー:
 * 1. 認証 + application の所有確認
 * 2. クライアントから来た最新ユーザーメッセージをDB保存
 *    (ダミー「(セッション開始)」は保存しない:キャリア棚卸し側と同じ運用)
 * 3. application / tasks / career_profile を並列取得してコンテキスト構築
 * 4. system に「プロンプト + コンテキスト」を入れて Anthropic API へストリーミング
 * 5. onFinish で AI 応答をDB保存
 */

/** 新規セッションで Myaira の最初の挨拶を引き出すためのダミー入力(DB 保存しない) */
const SESSION_OPENER = "(セッション開始)";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { id: applicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isOwner = await verifyApplicationOwner(applicationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { messages?: UIMessage[]; conversationId?: string };
  try {
    body = (await request.json()) as {
      messages?: UIMessage[];
      conversationId?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, conversationId } = body;
  if (!messages || !Array.isArray(messages) || !conversationId) {
    return NextResponse.json(
      { error: "messages and conversationId are required" },
      { status: 400 },
    );
  }

  // conversation が application_tracker モジュールでこのユーザーのものか確認
  const { data: conv } = await supabase
    .from("conversations")
    .select("user_id, module, metadata")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv || conv.user_id !== user.id || conv.module !== "application_tracker") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 必要な文脈情報を並列取得
  const [application, tasks, profileData] = await Promise.all([
    getApplication(applicationId, user.id),
    listTasksByApplication(applicationId, user.id),
    getCareerProfile(user.id),
  ]);

  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!profileData) {
    return NextResponse.json(
      {
        error: "Career profile not found",
        message: "先にキャリア棚卸しを完了させてください",
      },
      { status: 400 },
    );
  }

  // 最新のユーザーメッセージをDB保存(ダミーオープナーは除外)
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === "user") {
    const userContent = lastMessage.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");

    if (userContent && userContent !== SESSION_OPENER) {
      await saveMessage({
        conversationId,
        userId: user.id,
        role: "user",
        content: userContent,
      });
    }
  }

  // システムプロンプト + 応募コンテキストを連結
  const contextString = buildAdvisorContext({
    application,
    tasks,
    profile: profileData.profile,
  });
  const fullSystemPrompt = `${APPLICATION_ADVISOR_SYSTEM_PROMPT}\n\n${contextString}`;

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: getModel(MODELS.CONVERSATION),
    system: fullSystemPrompt,
    messages: modelMessages,
    onError: ({ error }) => {
      // C2-3: 分類 + サーバー ログ + 429 の 場合 は 監視 テーブル に 記録
      logAiStreamError(error, "Advisor");
    },
    onFinish: async ({ text, usage }) => {
      // ストリーミング完了時の保存失敗はユーザー応答に影響させない
      try {
        await saveMessage({
          conversationId,
          userId: user.id,
          role: "assistant",
          content: text,
          modelUsed: MODELS.CONVERSATION,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
        });
      } catch (err) {
        console.error("Failed to save advisor assistant message:", err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}

import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { getModel, MODELS } from "@/lib/ai/client";
import { categorizeAIError } from "@/lib/ai/error-handler";
import { CAREER_INVENTORY_SYSTEM_PROMPT } from "@/lib/ai/prompts/career-inventory";
import { createClient } from "@/lib/supabase/server";
import { saveMessage, verifyConversationOwner } from "@/lib/career/conversations";

/**
 * キャリア棚卸しチャットAPI(ストリーミング応答)
 *
 * フロー:
 * 1. 認証チェック
 * 2. conversationId の所有者・モジュール一致確認
 * 3. クライアントから来た最新ユーザーメッセージをDB保存
 *    (ただし新規セッション用のダミー「(セッション開始)」は保存しない)
 * 4. Anthropic API へストリーミング
 * 5. ストリーミング完了時、AI応答をDB保存(onFinish)
 *
 * Edge Runtime は採用しない(Supabase Auth クッキー処理との組み合わせ検証が
 * 未完のため。Node.js ランタイムで動かす)。
 */

/** 新規セッションで Maira の挨拶を引き出すためのダミー入力 */
const SESSION_OPENER = "(セッション開始)";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // 所有者・モジュール一致確認
  const isOwner = await verifyConversationOwner(conversationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 最新のユーザーメッセージをDB保存
  // ダミーオープナーはDB保存しない(UI側でも非表示にしている)
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

  // convertToModelMessages は v6 から Promise を返すため await が必要
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: getModel(MODELS.CONVERSATION),
    system: CAREER_INVENTORY_SYSTEM_PROMPT,
    messages: modelMessages,
    onError: ({ error }) => {
      // ストリーミング中のエラーはサーバーログに分類して残す。
      // クライアントには AI SDK 経由で useChat.error として伝わる。
      const info = categorizeAIError(error);
      console.error("Career chat streaming error:", info.category, info.userMessage, error);
    },
    onFinish: async ({ text, usage }) => {
      // ストリーミング完了時にAI応答をDB保存。
      // ここで失敗してもユーザーへの応答ストリームには影響させない。
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
        console.error("Failed to save assistant message:", err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}

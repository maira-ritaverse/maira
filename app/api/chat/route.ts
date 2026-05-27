import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { getModel, MODELS } from "@/lib/ai/client";
import { categorizeAIError } from "@/lib/ai/error-handler";
import { TEST_CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompts/test-chat";
import { createClient } from "@/lib/supabase/server";

/**
 * チャットAPI(ストリーミング応答)
 *
 * 認証必須。未ログインユーザーは 401 を返す。
 * 暗号化機能は未実装(Week 3 で本実装)。
 * 会話履歴の保存も未実装(動作確認用のため完全揮発)。
 *
 * ランタイムは Node.js を使う。Edge Runtime は Supabase Auth の
 * createClient() との組み合わせで動作確認が必要なため当面は採用しない。
 */
export async function POST(request: Request) {
  // 認証チェック:未ログインなら 401 を返す
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // リクエストボディの検証
  let body: { messages?: UIMessage[] };
  try {
    body = (await request.json()) as { messages?: UIMessage[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  // Claude API へストリーミングリクエスト
  // convertToModelMessages は v6 から Promise を返すため await が必要
  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: getModel(MODELS.CONVERSATION),
    system: TEST_CHAT_SYSTEM_PROMPT,
    messages: modelMessages,
    onError: ({ error }) => {
      // ストリーミング中のエラーはサーバーログに分類して残す。
      // クライアントには AI SDK 経由で useChat.error として伝わる。
      const info = categorizeAIError(error);
      console.error("Chat streaming error:", info.category, info.userMessage, error);
    },
  });

  return result.toUIMessageStreamResponse();
}

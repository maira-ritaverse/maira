import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { NextResponse } from "next/server";

import { getModel, MODELS } from "@/lib/ai/client";
import { categorizeAIError } from "@/lib/ai/error-handler";
import { buildInterviewSystemPrompt } from "@/lib/ai/prompts/mock-interview";
import { createClient } from "@/lib/supabase/server";

/**
 * 面接シミュレーター(β:テキスト)チャット API
 *
 * - 認証必須(seeker / agent どちらでも可)
 * - 履歴は DB に保存しない(β機能、永続化は本格ローンチで対応)
 * - 1 セッションあたり 5〜8 問、最後に総評で終了する system prompt 制御
 *
 * 将来:音声 I/O 対応時に Anthropic の音声入出力 / Whisper 連携などに切り替える。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    messages?: UIMessage[];
    positionContext?: {
      companyName?: string;
      position?: string;
      requiredSkills?: string;
    };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages, positionContext } = body;
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: getModel(MODELS.CONVERSATION),
    system: buildInterviewSystemPrompt(positionContext),
    messages: modelMessages,
    onError: ({ error }) => {
      const info = categorizeAIError(error);
      console.error("[interview chat] streaming error:", info.category, info.userMessage, error);
    },
  });

  return result.toUIMessageStreamResponse();
}

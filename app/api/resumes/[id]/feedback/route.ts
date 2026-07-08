import { streamText } from "ai";
import { NextResponse } from "next/server";

import { getModel, MODELS } from "@/lib/ai/client";
import { logAiStreamError } from "@/lib/ai/rate-limit-monitor";
import { RESUME_FEEDBACK_SYSTEM_PROMPT } from "@/lib/ai/prompts/resume-feedback";
import { getResume } from "@/lib/resumes/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/resumes/[id]/feedback
 *
 * 履歴書の構造化データを AI で添削。
 * - 認証必須・所有者チェック
 * - 履歴書本体は暗号化されているので、server-side で復号 → AI へ送信
 * - レスポンスはストリーミング(Markdown)
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resume = await getResume(id, user.id);
  if (!resume) return NextResponse.json({ error: "Resume not found" }, { status: 404 });

  // AI に渡す要約テキスト(個人特定情報は最小限に)
  const eduLines = resume.educationHistory
    .map((e) => `  - ${e.year ?? "?"}年${e.month ?? "?"}月: ${e.description}`)
    .join("\n");
  const licenseLines = resume.licenses
    .map((l) => `  - ${l.year ?? "?"}年${l.month ?? "?"}月: ${l.name}`)
    .join("\n");

  const resumeText = `# 提出履歴書(構造化サマリ)

## 学歴・職歴
${eduLines || "  (未入力)"}

## 免許・資格
${licenseLines || "  (未入力)"}

## 志望動機・特技・アピールポイント(自由記述)
${resume.motivationNote || "(未入力)"}

## 本人希望記入欄
${resume.personalRequests || "(未入力)"}
`;

  const result = streamText({
    model: getModel(MODELS.CONVERSATION),
    system: RESUME_FEEDBACK_SYSTEM_PROMPT,
    prompt: `以下の履歴書を採用担当者の視点で添削してください。具体的なリライト例を必ず含めてください。

${resumeText}`,
    onError: ({ error }) => {
      // C2-3: 分類 + ログ + 429 の 場合 は 監視 テーブル に 記録
      logAiStreamError(error, "[resume feedback]");
    },
  });

  return result.toTextStreamResponse();
}

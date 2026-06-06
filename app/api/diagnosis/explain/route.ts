import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getModel, MODELS } from "@/lib/ai/client";
import { aiErrorToStatusCode, categorizeAIError } from "@/lib/ai/error-handler";
import {
  buildDiagnosisExplainUserPrompt,
  DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/diagnosis-explain";
import { suggestJobs, type AxisResult, type AptitudeResult } from "@/lib/diagnosis/scoring";
import { createClient } from "@/lib/supabase/server";

// 受け付け可能な軸タイプ・適性因子は固定。リテラルで列挙して zod に渡し、
// 自由文字列が AI のプロンプトに紛れ込むのを防ぐ(プロンプトインジェクション防止)。
const axisTypes = [
  "specialist",
  "management",
  "autonomy",
  "security",
  "entrepreneur",
  "service",
  "challenge",
  "lifestyle",
] as const;

const aptitudeFactors = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "stability",
] as const;

const requestSchema = z.object({
  primaryAxis: z.enum(axisTypes),
  secondaryAxis: z.enum(axisTypes).nullable(),
  topStrengths: z.array(z.enum(aptitudeFactors)).max(3),
});

/**
 * 診断結果の説明文を生成する API
 *
 * 入力:診断結果のうち、説明に必要な最小限(主軸 / 次点 / 上位の強み)。
 * 職種候補リストは、サーバー側で suggestJobs() を呼んで固定マッピング
 * (axisToJobs)から再導出する。クライアントから自由な職種文字列を受け取らない
 * ことで、AI に「未知の職種」が渡る経路を遮断する(履歴書AI下書きと同じ
 * 「事実は捏造させない」原則)。
 *
 * 出力:プレーンテキストの説明文 + 採用された職種カテゴリ(画面表示用)。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // バリデーション。zod で弾けば AI に渡る入力は安全な範囲のみ。
  const raw = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { primaryAxis, secondaryAxis, topStrengths } = parsed.data;

  // 職種をサーバー側で導出(クライアント任せにしない)。
  // suggestJobs は scores を参照しないので、最小限のダミーで足りる。
  const axisResultLike: AxisResult = {
    primary: primaryAxis,
    secondary: secondaryAxis,
    scores: {} as AxisResult["scores"],
  };
  const aptitudeResultLike: AptitudeResult = {
    scores: {} as AptitudeResult["scores"],
    topStrengths,
  };
  const jobSuggestion = suggestJobs(axisResultLike, aptitudeResultLike);

  // プロンプト構築 → AI 呼び出し。
  const userPrompt = buildDiagnosisExplainUserPrompt({
    primaryAxis,
    secondaryAxis,
    topStrengths,
    jobs: jobSuggestion.categories,
    aptitudeHint: jobSuggestion.aptitudeHint,
  });

  try {
    // モデル選定:説明文の温かいトーンが品質に直結するため CONVERSATION(Sonnet)を使う。
    // 将来コスト最適化したい場合は LIGHT(Haiku)に切り替え可。
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system: DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    return NextResponse.json({
      explanation: result.text,
      jobs: jobSuggestion.categories,
      aptitudeHint: jobSuggestion.aptitudeHint,
    });
  } catch (error) {
    console.error("Diagnosis explanation error:", error);
    const info = categorizeAIError(error);
    return NextResponse.json(
      {
        error: "Failed to generate explanation",
        message: info.userMessage,
        category: info.category,
        retryable: info.retryable,
      },
      { status: aiErrorToStatusCode(info.category) },
    );
  }
}

// AI 呼び出しは数十秒かかり得るので、Next.js のデフォルトタイムアウトを延長。
// 説明文は短い(200-400字)が、ネットワークやレートリミットを考慮して 120s。
export const maxDuration = 120;

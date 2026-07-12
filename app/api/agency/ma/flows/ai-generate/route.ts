/**
 * POST /api/agency/ma/flows/ai-generate
 *
 * admin の 自然文 の 意図 を Claude Sonnet 4.6 に 渡し、 Flow の 構造 化 提案 を
 * JSON で 返す。 保存 は 別 エンドポイント (POST /api/agency/ma/flows +
 * PUT /api/agency/ma/flows/[id]/steps) で 行う。
 *
 * 認可 :organization admin のみ
 *
 * TODO:AI 使用 上限 (checkAiUsageLimit / recordAiUsage) は 別 コミット で 追加。
 *      現状 は 総量 制限 (PLATFORM_AI_TOTAL) のみ で 個別 kind 制限 なし。
 */
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { assertAnthropicConfigured, getModel, MODELS } from "@/lib/ai/client";
import {
  AIFlowProposalSchema,
  FLOW_GENERATION_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/flow-generation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().min(5).max(2000),
});

export async function POST(request: Request) {
  const guard = await requireOrgAdmin();
  if (!guard.ok) return guard.response;

  try {
    assertAnthropicConfigured();
  } catch {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
  }

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: AIFlowProposalSchema,
      system: FLOW_GENERATION_SYSTEM_PROMPT,
      prompt: `<user_intent>\n${parsed.data.prompt}\n</user_intent>`,
    });

    return NextResponse.json({ proposal: result.object });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "generation_failed", message: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}

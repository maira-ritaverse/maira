/**
 * POST /api/agency/ma/segments/ai-generate
 *
 * admin の 自然文 意図 → Claude が SegmentCondition ツリー を 生成。
 * filter_dsl_json_stringified を JSON.parse して SegmentFilterSchema で 検証 する。
 *
 * 認可 :organization admin のみ
 * 上限 :agency_ma_segment_generation
 */
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { assertAnthropicConfigured, getModel, MODELS } from "@/lib/ai/client";
import {
  AISegmentProposalSchema,
  SEGMENT_GENERATION_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/segment-generation";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { SegmentFilterSchema, type SegmentFilter } from "@/lib/ma/segment-dsl";

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

  const usage = await checkAiUsageLimit(
    guard.supabase,
    guard.user.id,
    "agency_ma_segment_generation",
  );
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "ai_limit_exceeded",
        message: `今月 の AI Segment 生成 上限 (${usage.limit} 回) に 達しました。 リセット: ${usage.resetsAt}`,
        current: usage.current,
        limit: usage.limit,
      },
      { status: 429 },
    );
  }

  let filter: SegmentFilter;
  let name: string;
  let description: string;
  let narrative: string;
  let usesReserved: boolean;

  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: AISegmentProposalSchema,
      system: SEGMENT_GENERATION_SYSTEM_PROMPT,
      prompt: `<user_intent>\n${parsed.data.prompt}\n</user_intent>`,
    });

    // filter_dsl_json_stringified を parse + SegmentFilterSchema で 検証
    const raw = JSON.parse(result.object.filter_dsl_json_stringified) as unknown;
    filter = SegmentFilterSchema.parse(raw);
    name = result.object.name;
    description = result.object.description;
    narrative = result.object.narrative;
    usesReserved = result.object.uses_reserved_kinds;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "generation_failed", message: msg.slice(0, 500) },
      { status: 500 },
    );
  }

  await recordAiUsage(guard.supabase, guard.user.id, "agency_ma_segment_generation");

  return NextResponse.json({
    proposal: {
      name,
      description,
      filter,
      narrative,
      uses_reserved_kinds: usesReserved,
    },
  });
}

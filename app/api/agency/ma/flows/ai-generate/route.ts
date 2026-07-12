/**
 * POST /api/agency/ma/flows/ai-generate
 *
 * 自然文の意図を Claude Sonnet 4.6 に渡し、Flow 提案を JSON で返す。
 * 事前に組織の既存タグ・セグメント・テンプレ・稼働 Flow をコンテキストとして
 * 渡し、AI が実 UUID を含む「そのまま動く」提案を返せるようにする。
 */
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgAdmin } from "@/lib/api/auth-guards";
import { assertAnthropicConfigured, getModel, MODELS } from "@/lib/ai/client";
import {
  AIFlowProposalSchema,
  buildFlowGenerationSystemPrompt,
  type OrgContextForAI,
} from "@/lib/ai/prompts/flow-generation";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { listOrganizationLineTags } from "@/lib/line/conversation-tags";
import { listMaTemplatesForOrg } from "@/lib/ma/flow-queries";
import { listSegmentsForOrg } from "@/lib/ma/segment-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  prompt: z.string().min(5).max(2000),
  /** 生成する Flow の送信チャネル(未指定は line) */
  channel: z.enum(["line", "email"]).optional(),
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

  const usage = await checkAiUsageLimit(guard.supabase, guard.user.id, "agency_ma_flow_generation");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "ai_limit_exceeded",
        message: `今月の AI Flow 生成の上限(${usage.limit}回)に達しました。次回リセット: ${usage.resetsAt}`,
        current: usage.current,
        limit: usage.limit,
      },
      { status: 429 },
    );
  }

  // 組織のコンテキストを取得(既存タグ・セグメント・テンプレ・稼働 Flow)
  const [tags, segments, templates, flowsRes] = await Promise.all([
    listOrganizationLineTags(guard.organization.id),
    listSegmentsForOrg(guard.supabase, guard.organization.id),
    listMaTemplatesForOrg(guard.supabase, guard.organization.id),
    guard.supabase
      .from("ma_flows")
      .select("name")
      .eq("organization_id", guard.organization.id)
      .eq("is_active", true),
  ]);

  const context: OrgContextForAI = {
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    segments: segments.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.scenario_name ?? "テンプレート",
    })),
    activeFlowNames: (flowsRes.data ?? []).map((f: { name: string }) => f.name),
    channel: parsed.data.channel ?? "line",
  };

  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: AIFlowProposalSchema,
      system: buildFlowGenerationSystemPrompt(context),
      prompt: `<user_intent>\n${parsed.data.prompt}\n</user_intent>`,
    });

    await recordAiUsage(guard.supabase, guard.user.id, "agency_ma_flow_generation");
    return NextResponse.json({ proposal: result.object });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "generation_failed", message: msg.slice(0, 500) },
      { status: 500 },
    );
  }
}

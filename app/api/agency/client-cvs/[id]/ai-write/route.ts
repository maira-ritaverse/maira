import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { generateCvText } from "@/lib/agency-client-documents/ai-write";
import { getAgencyClientCv, listHearingSheets } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/agency/client-cvs/[id]/ai-write
 *
 * Claude(claude-sonnet-4-6)で職務経歴書の「要約」「本文」を生成する。
 *
 * 入力:
 *   { kind: "cv_summary" | "cv_body" }
 * 出力:
 *   { text: string }
 *
 * Storage / DB は触らない。クライアント側で確認 → 上書き保存。
 * hearing は client_record で最も新しいもの 1 件を使う。
 */
const bodySchema = z.object({
  kind: z.enum(["cv_summary", "cv_body"]),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, user } = guard;

  const { id: cvId } = await params;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 組織横断 月次上限チェック(admin が /agency/settings/ai-usage で設定)
  const supabase = await createClient();
  const usage = await checkAiUsageLimit(supabase, user.id, "agency_cv_draft");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました(${usage.current} / ${usage.limit})。来月のリセット後、または 管理者が設定変更後に再試行してください。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  const cv = await getAgencyClientCv(cvId, organization.id);
  if (!cv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const client = await getClientRecord(cv.clientRecordId);
  if (!client) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }

  const hearingSheets = await listHearingSheets(cv.clientRecordId, organization.id);
  const hearing = hearingSheets[0]?.content ?? null;

  const result = await generateCvText({
    clientName: client.name,
    hearing,
    kind: parsed.data.kind,
    existing: { summary: cv.body.summary, body: cv.body.body },
  });
  if (!result.ok) {
    return NextResponse.json({ error: "ai_failed", message: result.reason }, { status: 502 });
  }

  await recordAiUsage(supabase, user.id, "agency_cv_draft", {
    cv_id: cvId,
    kind: parsed.data.kind,
  });

  return NextResponse.json({ text: result.text });
}

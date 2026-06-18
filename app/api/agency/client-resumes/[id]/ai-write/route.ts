import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { generateResumeText } from "@/lib/agency-client-documents/ai-write";
import { getAgencyClientResume, listHearingSheets } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/agency/client-resumes/[id]/ai-write
 *
 * Claude(claude-sonnet-4-6)で履歴書の「志望動機」「自己 PR」本文を生成する。
 *
 * 入力:
 *   { kind: "motivation" | "self_pr" }
 *
 * 出力:
 *   { text: string }
 *
 * 注意:
 *   ・Storage / DB は触らない。生成した文章はクライアント側で
 *     プレビュー → 承認 → 履歴書本体に貼り付けて保存、の 2 段階。
 *   ・hearing は client_record で最も新しいもの 1 件を使う。
 */

const bodySchema = z.object({
  kind: z.enum(["motivation", "self_pr"]),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, user } = guard;

  const { id: resumeId } = await params;

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
  const usage = await checkAiUsageLimit(supabase, user.id, "agency_resume_draft");
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

  const resume = await getAgencyClientResume(resumeId, organization.id);
  if (!resume) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const client = await getClientRecord(resume.clientRecordId);
  if (!client) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }

  // 最も新しいヒアリングシートを 1 件使う(無くても生成は走る)
  const hearingSheets = await listHearingSheets(resume.clientRecordId, organization.id);
  const hearing = hearingSheets[0]?.content ?? null;

  const result = await generateResumeText({
    clientName: client.name,
    resume,
    hearing,
    kind: parsed.data.kind,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "ai_failed", message: result.reason }, { status: 502 });
  }

  // 成功時のみ ai_usage_events に記録(失敗しても本処理は止めない)
  await recordAiUsage(supabase, user.id, "agency_resume_draft", {
    resume_id: resumeId,
    kind: parsed.data.kind,
  });

  return NextResponse.json({ text: result.text });
}

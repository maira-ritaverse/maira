import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/clients/[id]/intake-recording/transcript
 *
 * 録音の文字起こし本文と、AI 抽出の充足サマリ(何がどれだけ取れたか)を返す。
 * 「録音したのに書類がスカスカ」を切り分けるための確認ビュー用:
 *   ・文字起こしが空/短い → 音声・形式・Whisper の問題
 *   ・文字起こしはあるが抽出サマリが 0 件だらけ → 抽出プロンプト/内容の問題
 *
 * 認可: requireOrgMember + 録音が呼び出し組織のクライアントのものであることを確認。
 * 復号はサーバ側のみ。対象は自組織クライアントの面談録音なので、平文をエージェントに返してよい。
 */
const bodySchema = z.object({ recordingId: z.string().uuid() });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;
  const { id: clientRecordId } = await context.params;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  // クライアントが自組織のものか(RLS と二重防御)
  const { data: clientRow } = await supabase
    .from("client_records")
    .select("id, organization_id")
    .eq("id", clientRecordId)
    .maybeSingle();
  if (
    !clientRow ||
    (clientRow as { organization_id: string }).organization_id !== organization.id
  ) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: rec } = await service
    .from("career_intake_recordings")
    .select(
      "id, client_record_id, status, status_message, encrypted_transcript, encrypted_extraction",
    )
    .eq("id", parsed.data.recordingId)
    .maybeSingle();
  const r = rec as {
    client_record_id: string | null;
    status: string;
    status_message: string | null;
    encrypted_transcript: string | null;
    encrypted_extraction: string | null;
  } | null;
  if (!r || r.client_record_id !== clientRecordId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let transcript = "";
  if (r.encrypted_transcript) {
    try {
      transcript = await decryptField(r.encrypted_transcript);
    } catch {
      transcript = "";
    }
  }

  // 抽出結果の「充足サマリ」。値そのものではなく件数・有無で、どこが空かを見せる。
  let extractionSummary: Record<string, number | boolean> | null = null;
  if (r.encrypted_extraction) {
    try {
      const ext = extractionResultSchema.parse(
        JSON.parse(await decryptField(r.encrypted_extraction)),
      );
      extractionSummary = {
        workExperiences: ext.workExperiences?.length ?? 0,
        educationHistory: ext.educationHistory?.length ?? 0,
        workHistory: ext.workHistory?.length ?? 0,
        licenses: ext.licenses?.length ?? 0,
        skills: ext.skills?.length ?? 0,
        hasSelfPr: Boolean(ext.selfPr && ext.selfPr.trim()),
        hasCareerSummary: Boolean(ext.careerSummary && ext.careerSummary.trim()),
        hasMotivation: Boolean(ext.motivationNote && ext.motivationNote.trim()),
        desiredConditions:
          (ext.desiredIndustries?.length ?? 0) +
          (ext.desiredOccupations?.length ?? 0) +
          (ext.desiredLocations?.length ?? 0),
      };
    } catch {
      extractionSummary = null;
    }
  }

  return NextResponse.json({
    status: r.status,
    statusMessage: r.status_message,
    transcriptLength: transcript.length,
    transcript,
    extractionSummary,
  });
}

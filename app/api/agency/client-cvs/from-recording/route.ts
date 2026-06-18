import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { mergeExtractionIntoCvBody } from "@/lib/agency-client-documents/extraction-to-resume";
import {
  createAgencyClientCv,
  getAgencyClientCv,
  updateAgencyClientCv,
} from "@/lib/agency-client-documents/queries";
import { cvBodySchema } from "@/lib/agency-client-documents/types";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { getClientRecord } from "@/lib/clients/queries";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/client-cvs/from-recording
 *
 * career_intake_recordings.extraction(status=extracted)から
 * agency_client_cvs を新規作成 / 既存にマージ する。
 *
 * 入力:
 *   {
 *     recording_id,
 *     client_record_id,
 *     target_cv_id?   // ある場合は既存職務経歴書に追記
 *   }
 *
 * 動作:
 *   ・recording が同 organization の client_record の録音であることを確認
 *   ・status='extracted' でなければ 409 で拒否
 *   ・target_cv_id があれば overrideIfEmpty 方針でマージ
 *   ・無ければ新規作成(タイトル「面談から生成(yyyy/mm/dd)」)
 *   ・source_recording_id を打刻
 */
const bodySchema = z.object({
  recording_id: z.string().uuid(),
  client_record_id: z.string().uuid(),
  target_cv_id: z.string().uuid().optional(),
});

type IntakeRow = {
  id: string;
  client_record_id: string | null;
  meeting_schedule_id: string | null;
  status: string;
  encrypted_extraction: string | null;
};

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization, member } = guard;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: recordingRow, error: recErr } = await service
    .from("career_intake_recordings")
    .select("id, client_record_id, meeting_schedule_id, status, encrypted_extraction")
    .eq("id", parsed.data.recording_id)
    .maybeSingle();
  if (recErr || !recordingRow) {
    return NextResponse.json({ error: "recording_not_found" }, { status: 404 });
  }
  const rec = recordingRow as IntakeRow;
  if (rec.client_record_id !== parsed.data.client_record_id) {
    return NextResponse.json({ error: "recording_client_mismatch" }, { status: 403 });
  }
  if (rec.status !== "extracted") {
    return NextResponse.json(
      { error: "recording_not_extracted", message: "AI 抽出が完了していません" },
      { status: 409 },
    );
  }

  const client = await getClientRecord(parsed.data.client_record_id);
  if (!client || client.organizationId !== organization.id) {
    return NextResponse.json({ error: "client_org_mismatch" }, { status: 403 });
  }

  if (!rec.encrypted_extraction) {
    return NextResponse.json({ error: "extraction_missing" }, { status: 409 });
  }
  const extractionPlain = await decryptField(rec.encrypted_extraction);
  if (!extractionPlain) {
    return NextResponse.json({ error: "extraction_decrypt_failed" }, { status: 500 });
  }
  let extraction;
  try {
    extraction = extractionResultSchema.parse(JSON.parse(extractionPlain));
  } catch {
    return NextResponse.json({ error: "extraction_invalid_shape" }, { status: 500 });
  }

  if (parsed.data.target_cv_id) {
    const existing = await getAgencyClientCv(parsed.data.target_cv_id, organization.id);
    if (!existing || existing.clientRecordId !== client.id) {
      return NextResponse.json({ error: "cv_not_found" }, { status: 404 });
    }
    const mergedBody = mergeExtractionIntoCvBody(existing.body, extraction);
    const result = await updateAgencyClientCv({
      id: existing.id,
      organizationId: organization.id,
      body: mergedBody,
    });
    if ("error" in result) {
      return NextResponse.json({ error: "update_failed", message: result.error }, { status: 500 });
    }
    await service
      .from("agency_client_cvs")
      .update({ source_recording_id: rec.id })
      .eq("id", existing.id)
      .eq("organization_id", organization.id);
    return NextResponse.json({ item: result });
  }

  // 新規作成
  const initialBody = cvBodySchema.parse({});
  const cvBody = mergeExtractionIntoCvBody(initialBody, extraction);
  const today = new Date().toISOString().slice(0, 10);
  const title = `面談から生成(${today})`;

  const created = await createAgencyClientCv({
    organizationId: organization.id,
    clientRecordId: client.id,
    createdByMemberId: member.id,
    title,
    documentDate: today,
    body: cvBody,
  });
  if ("error" in created) {
    return NextResponse.json({ error: "create_failed", message: created.error }, { status: 500 });
  }
  await service
    .from("agency_client_cvs")
    .update({ source_recording_id: rec.id })
    .eq("id", created.id)
    .eq("organization_id", organization.id);
  return NextResponse.json({ item: created }, { status: 201 });
}

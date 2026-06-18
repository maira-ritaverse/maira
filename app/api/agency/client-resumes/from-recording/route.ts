import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import {
  mergeExtractionIntoEducation,
  mergeExtractionIntoLicenses,
  mergeExtractionIntoResumePii,
} from "@/lib/agency-client-documents/extraction-to-resume";
import {
  createAgencyClientResume,
  getAgencyClientResume,
  updateAgencyClientResume,
} from "@/lib/agency-client-documents/queries";
import { resumePiiSchema } from "@/lib/agency-client-documents/types";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { getClientRecord } from "@/lib/clients/queries";
import { decryptField } from "@/lib/crypto/field-encryption";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/client-resumes/from-recording
 *
 * career_intake_recordings.extraction(status=extracted)から
 * agency_client_resumes を新規作成 / 既存にマージ する。
 *
 * 入力:
 *   {
 *     recording_id,
 *     client_record_id,
 *     target_resume_id?   // ある場合は既存履歴書に追記
 *   }
 *
 * 動作:
 *   ・recording が同 organization の client_record の録音であることを確認
 *   ・status='extracted' でなければ 409 で拒否
 *   ・target_resume_id があれば overrideIfEmpty 方針でマージ
 *   ・無ければ新規作成(タイトル「面談から生成 yyyy/mm/dd」)
 *   ・source_recording_id を打刻
 *
 * セキュリティ:
 *   ・requireOrgMember(archived ガード込み)
 *   ・recording と client_record の組織境界を service_role で 二重チェック
 */
const bodySchema = z.object({
  recording_id: z.string().uuid(),
  client_record_id: z.string().uuid(),
  target_resume_id: z.string().uuid().optional(),
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

  // 録音の所有確認(service_role:career_intake_recordings は本人所有 RLS なので
  // agency セッションでは見えない。client_record_id 経由で組織境界を再確認)。
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

  // client_record の organization 一致
  const client = await getClientRecord(parsed.data.client_record_id);
  if (!client || client.organizationId !== organization.id) {
    return NextResponse.json({ error: "client_org_mismatch" }, { status: 403 });
  }

  // extraction 復号 + parse
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

  // target_resume_id があれば既存にマージ、無ければ新規作成
  if (parsed.data.target_resume_id) {
    const existing = await getAgencyClientResume(parsed.data.target_resume_id, organization.id);
    if (!existing || existing.clientRecordId !== client.id) {
      return NextResponse.json({ error: "resume_not_found" }, { status: 404 });
    }
    const mergedPii = mergeExtractionIntoResumePii(existing.pii, extraction, client.name);
    const mergedEdu = mergeExtractionIntoEducation(existing.educationHistory, extraction);
    const mergedLic = mergeExtractionIntoLicenses(existing.licenses, extraction);
    const result = await updateAgencyClientResume({
      id: existing.id,
      organizationId: organization.id,
      pii: mergedPii,
      educationHistory: mergedEdu,
      licenses: mergedLic,
    });
    if ("error" in result) {
      return NextResponse.json({ error: "update_failed", message: result.error }, { status: 500 });
    }
    // source_recording_id を打刻(service_role で 1 回 UPDATE)
    await service
      .from("agency_client_resumes")
      .update({ source_recording_id: rec.id })
      .eq("id", existing.id)
      .eq("organization_id", organization.id);
    return NextResponse.json({ item: result });
  }

  // 新規作成
  const initialPii = resumePiiSchema.parse({});
  const pii = mergeExtractionIntoResumePii(initialPii, extraction, client.name);
  const education = mergeExtractionIntoEducation([], extraction);
  const licenses = mergeExtractionIntoLicenses([], extraction);

  const today = new Date().toISOString().slice(0, 10);
  const title = `面談から生成(${today})`;

  const created = await createAgencyClientResume({
    organizationId: organization.id,
    clientRecordId: client.id,
    createdByMemberId: member.id,
    title,
    documentDate: today,
    pii,
    educationHistory: education,
    licenses,
  });
  if ("error" in created) {
    return NextResponse.json({ error: "create_failed", message: created.error }, { status: 500 });
  }
  await service
    .from("agency_client_resumes")
    .update({ source_recording_id: rec.id })
    .eq("id", created.id)
    .eq("organization_id", organization.id);
  return NextResponse.json({ item: created }, { status: 201 });
}

import { NextResponse } from "next/server";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import {
  createHearingSheet,
  getHearingSheet,
  updateHearingSheet,
} from "@/lib/agency-client-documents/queries";
import { mergeExtractionIntoHearing } from "@/lib/agency-client-documents/extraction-to-hearing";
import { hearingSheetContentSchema } from "@/lib/agency-client-documents/types";
import { decryptField } from "@/lib/crypto/field-encryption";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { createServiceClient } from "@/lib/supabase/service";
import { z } from "zod";

/**
 * POST /api/agency/hearing-sheets/from-recording
 *
 * career_intake_recordings の extraction(status=extracted)を
 * 既存 / 新規の hearing_sheets.content にマージして書き戻すエンドポイント。
 *
 * 入力:
 *   { recording_id, client_record_id, target_sheet_id? }
 *
 * 動作:
 *   ・recording が「同 organization 配下の client_record の録音」であることを確認
 *     (career_intake_recordings は seeker 所有もあるが、client_record_id 列を
 *      参照して org 境界を確かめる)
 *   ・status が "extracted" でなければ 409 で拒否
 *   ・target_sheet_id があればその sheet に merge、無ければ新規作成
 *   ・ai_extracted_at を打刻
 *
 * セキュリティ:
 *   ・requireOrgMember(archived ガード込み)
 *   ・録音の所有確認は service_role で行う(career_intake_recordings は本人
 *     ベース RLS。クライアント側からは見えないので、エージェント API では
 *     明示的にチェックする必要がある)
 */
const bodySchema = z.object({
  recording_id: z.string().uuid(),
  client_record_id: z.string().uuid(),
  target_sheet_id: z.string().uuid().optional(),
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

  // 録音の所有確認:client_record の組織が現ユーザの組織と一致すること
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
  // client_record の organization_id 一致確認
  const { data: clientRow } = await service
    .from("client_records")
    .select("organization_id")
    .eq("id", parsed.data.client_record_id)
    .maybeSingle();
  if (
    !clientRow ||
    (clientRow as { organization_id: string }).organization_id !== organization.id
  ) {
    return NextResponse.json({ error: "client_org_mismatch" }, { status: 403 });
  }
  if (rec.status !== "extracted") {
    return NextResponse.json(
      { error: "recording_not_extracted", message: "AI 抽出が完了していません" },
      { status: 409 },
    );
  }

  // extraction 復号 & parse
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

  // target_sheet_id があれば既存に merge、無ければ新規作成
  if (parsed.data.target_sheet_id) {
    const existing = await getHearingSheet(parsed.data.target_sheet_id, organization.id);
    if (!existing) {
      return NextResponse.json({ error: "sheet_not_found" }, { status: 404 });
    }
    const merged = mergeExtractionIntoHearing(existing.content, extraction);
    const result = await updateHearingSheet({
      id: existing.id,
      organizationId: organization.id,
      content: hearingSheetContentSchema.parse(merged),
    });
    if ("error" in result) {
      return NextResponse.json({ error: "update_failed", message: result.error }, { status: 500 });
    }
    // ai_extracted_at の更新は service_role で(updateHearingSheet では未対応)
    await service
      .from("hearing_sheets")
      .update({
        ai_extracted_at: new Date().toISOString(),
        source_recording_id: rec.id,
      })
      .eq("id", existing.id)
      .eq("organization_id", organization.id);
    const reloaded = await getHearingSheet(existing.id, organization.id);
    return NextResponse.json({ item: reloaded ?? result });
  }

  // 新規作成
  const initial = hearingSheetContentSchema.parse({});
  const merged = mergeExtractionIntoHearing(initial, extraction);
  const created = await createHearingSheet({
    organizationId: organization.id,
    clientRecordId: parsed.data.client_record_id,
    meetingScheduleId: rec.meeting_schedule_id,
    content: hearingSheetContentSchema.parse(merged),
    createdByMemberId: member.id,
  });
  if ("error" in created) {
    return NextResponse.json({ error: "create_failed", message: created.error }, { status: 500 });
  }
  await service
    .from("hearing_sheets")
    .update({
      ai_extracted_at: new Date().toISOString(),
      source_recording_id: rec.id,
    })
    .eq("id", created.id)
    .eq("organization_id", organization.id);
  const reloaded = await getHearingSheet(created.id, organization.id);
  return NextResponse.json({ item: reloaded ?? created }, { status: 201 });
}

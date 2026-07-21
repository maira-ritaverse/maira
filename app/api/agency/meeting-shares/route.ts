/**
 * POST /api/agency/meeting-shares
 *
 * エージェントが録画→文字起こし→抽出 を確認した上で、求職者本人に
 * 「この内容を履歴書 / 職務経歴書下書きに反映してよいか?」と確認を依頼する。
 *
 * 入力:
 *   { recordingId: uuid, reviewMessage?: string }
 *
 * 要件:
 *   ・recording は host_user_id 一致(自分が予約した面談の録画のみ)
 *   ・meeting_schedule に seeker_user_id があること(Myaira 未登録の求職者には共有不可)
 *   ・recording.status === 'extracted'(抽出済の行のみ)
 *   ・recording に 1 件しか share は作れない(unique 制約)
 *
 * 副作用:
 *   ・求職者本人に in-app 通知を 1 件発火
 *   ・(将来)メール通知も追加
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { encryptField } from "@/lib/crypto/field-encryption";
import { fireSeekerNotification } from "@/lib/notifications/in-app";

const requestSchema = z.object({
  recordingId: z.string().uuid(),
  reviewMessage: z.string().max(2000).optional().or(z.literal("")),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, supabase } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = requestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // 録音行を取得(RLS で host 本人のものしか取れないわけではないが、
  // meeting_schedule 経由で host を判定する)
  const { data: rec } = await supabase
    .from("career_intake_recordings")
    .select("id, user_id, status, meeting_schedule_id, transcript_purpose")
    .eq("id", input.recordingId)
    .maybeSingle();
  if (!rec) {
    return NextResponse.json({ error: "recording_not_found" }, { status: 404 });
  }
  const recording = rec as {
    id: string;
    user_id: string;
    status: string;
    meeting_schedule_id: string | null;
    transcript_purpose: string;
  };
  if (recording.transcript_purpose !== "agency_interview") {
    return NextResponse.json({ error: "not_agency_interview" }, { status: 400 });
  }
  if (recording.status !== "extracted") {
    return NextResponse.json(
      { error: "recording_not_extracted", status: recording.status },
      { status: 409 },
    );
  }
  if (!recording.meeting_schedule_id) {
    return NextResponse.json({ error: "no_meeting_schedule" }, { status: 400 });
  }

  // meeting_schedule を取って host / seeker を確認
  const { data: msRow } = await supabase
    .from("meeting_schedules")
    .select("id, host_user_id, seeker_user_id, title")
    .eq("id", recording.meeting_schedule_id)
    .maybeSingle();
  if (!msRow) {
    return NextResponse.json({ error: "meeting_schedule_not_found" }, { status: 404 });
  }
  const ms = msRow as {
    id: string;
    host_user_id: string;
    seeker_user_id: string | null;
    title: string;
  };
  if (ms.host_user_id !== user.id) {
    return NextResponse.json({ error: "not_host" }, { status: 403 });
  }
  if (!ms.seeker_user_id) {
    return NextResponse.json(
      {
        error: "seeker_not_registered",
        message: "求職者が Myaira アカウントを持っていないため共有できません",
      },
      { status: 409 },
    );
  }

  // 暗号化 + INSERT
  const encryptedReviewMessage = input.reviewMessage
    ? await encryptField(input.reviewMessage)
    : null;
  const { data: inserted, error } = await supabase
    .from("meeting_interview_shares")
    .insert({
      meeting_schedule_id: ms.id,
      seeker_user_id: ms.seeker_user_id,
      recording_id: recording.id,
      encrypted_review_message: encryptedReviewMessage,
    })
    .select("id, expires_at")
    .single();
  if (error) {
    // unique 制約違反 → 既に共有済み
    if (error.code === "23505") {
      return NextResponse.json({ error: "already_shared" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "db_insert_failed", message: error.message },
      { status: 500 },
    );
  }

  // 求職者本人に通知
  await fireSeekerNotification({
    userId: ms.seeker_user_id,
    payload: {
      kind: "meeting_invited", // 既存 payload を流用(meeting_review_request 専用は後で追加)
      title: `面談ノートのご確認: ${ms.title}`,
      href: buildAbsoluteUrl("/app"),
      meetingScheduleId: ms.id,
      meetingTitle: ms.title,
      startsAtIso: new Date().toISOString(),
      joinUrl: "",
      organizationName: "Myaira",
    },
  });

  const insertedRow = inserted as { id: string; expires_at: string };
  return NextResponse.json(
    { share: { id: insertedRow.id, expiresAt: insertedRow.expires_at } },
    { status: 201 },
  );
}

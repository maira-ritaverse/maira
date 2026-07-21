/**
 * 録音処理が完了した後の自動フォロー処理
 *
 * 「エージェントが代理アップロードした録音(transcript_purpose=agency_interview)」
 * が extracted まで進んだら、求職者本人にレビュー依頼を送る。
 *
 *   1. recording.client_record_id から client_records 経由で linked_user_id を取得
 *   2. linked_user_id が無ければ何もしない(本人 Myaira アカウントが無い)
 *   3. meeting_interview_shares を upsert(recording_id ユニーク制約に依存)
 *   4. 求職者本人に in-app 通知を 1 件発火
 *
 * service_role 前提:呼び出し側は pickup ルートのみ。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { fireSeekerNotification } from "@/lib/notifications/in-app";

export async function notifyShareFromAgencyIntake(args: {
  service: SupabaseClient;
  recordingId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { service, recordingId } = args;

  // 1) recording を取得
  const { data: recRow } = await service
    .from("career_intake_recordings")
    .select("id, client_record_id, transcript_purpose, status")
    .eq("id", recordingId)
    .maybeSingle();
  if (!recRow) return { ok: false, reason: "recording_not_found" };
  const rec = recRow as {
    id: string;
    client_record_id: string | null;
    transcript_purpose: string;
    status: string;
  };
  if (rec.transcript_purpose !== "agency_interview") {
    return { ok: false, reason: "not_agency_interview" };
  }
  if (!rec.client_record_id) {
    return { ok: false, reason: "no_client_record" };
  }
  if (rec.status !== "extracted") {
    return { ok: false, reason: `status_not_extracted: ${rec.status}` };
  }

  // 2) client_records から linked_user_id を取得
  const { data: clientRow } = await service
    .from("client_records")
    .select("id, name, linked_user_id")
    .eq("id", rec.client_record_id)
    .maybeSingle();
  if (!clientRow) return { ok: false, reason: "client_not_found" };
  const client = clientRow as { id: string; name: string; linked_user_id: string | null };
  if (!client.linked_user_id) {
    return { ok: false, reason: "client_not_linked" };
  }

  // 3) shares を upsert(同じ recording_id で何度も実行されても 1 件で済む)
  const { error: insErr } = await service.from("meeting_interview_shares").upsert(
    {
      meeting_schedule_id: null,
      seeker_user_id: client.linked_user_id,
      recording_id: rec.id,
      status: "pending",
    },
    { onConflict: "recording_id" },
  );
  if (insErr) {
    return { ok: false, reason: `shares_upsert_failed: ${insErr.message}` };
  }

  // 4) 求職者本人に in-app 通知
  try {
    await fireSeekerNotification({
      userId: client.linked_user_id,
      payload: {
        kind: "meeting_invited", // 既存 kind を流用(レビュー用 kind は将来追加)
        title: "エージェントからキャリア棚卸しの追加内容が届きました",
        href: buildAbsoluteUrl("/app"),
        meetingScheduleId: "",
        meetingTitle: "AI ヒアリング結果のレビュー",
        startsAtIso: new Date().toISOString(),
        joinUrl: "",
        organizationName: "Myaira",
      },
    });
  } catch {
    // 通知失敗は致命ではない(レビューはダッシュボード経由で見える)
  }

  return { ok: true };
}

/**
 * meeting_interview_shares の DB アクセス層(求職者向け 1 件 + リスト)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField } from "@/lib/crypto/field-encryption";

export type InterviewShareView = {
  id: string;
  meetingScheduleId: string;
  meetingTitle: string;
  meetingStartsAt: string;
  organizationName: string;
  hostDisplayName: string;
  reviewMessage: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  expiresAt: string;
  createdAt: string;
};

type ShareRow = {
  id: string;
  meeting_schedule_id: string | null;
  encrypted_review_message: string | null;
  status: "pending" | "accepted" | "rejected" | "expired";
  expires_at: string;
  created_at: string;
  meeting: {
    title: string;
    starts_at: string;
    host_user_id: string;
    organization_id: string | null;
  } | null;
  recording: {
    original_filename: string;
    user_id: string;
  } | null;
};

async function rowToView(client: SupabaseClient, row: ShareRow): Promise<InterviewShareView> {
  const reviewMessage = row.encrypted_review_message
    ? ((await decryptField(row.encrypted_review_message)) ?? "")
    : "";
  // host / organization の表示名を取得
  let hostDisplayName = "担当アドバイザー";
  let organizationName = "Myaira";
  // 表示名解決の優先順:meeting_schedules → recording.user_id → デフォルト
  const hostUserId = row.meeting?.host_user_id ?? row.recording?.user_id ?? null;
  if (hostUserId) {
    const { data: profile } = await client
      .from("profiles")
      .select("display_name")
      .eq("id", hostUserId)
      .maybeSingle();
    hostDisplayName =
      (profile as { display_name: string | null } | null)?.display_name ?? hostDisplayName;
  }
  if (row.meeting?.organization_id) {
    const { data: org } = await client
      .from("organizations")
      .select("name")
      .eq("id", row.meeting.organization_id)
      .maybeSingle();
    organizationName = (org as { name: string } | null)?.name ?? organizationName;
  }
  // タイトル:面談予約があればそれ、なければ録音ファイル名、無ければデフォルト
  const title = row.meeting?.title ?? row.recording?.original_filename ?? "AI ヒアリング";
  return {
    id: row.id,
    meetingScheduleId: row.meeting_schedule_id ?? "",
    meetingTitle: title,
    meetingStartsAt: row.meeting?.starts_at ?? row.created_at,
    organizationName,
    hostDisplayName,
    reviewMessage,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/** 求職者本人向けの「承認待ち」の共有のみ取得 */
export async function listPendingSharesForSeeker(
  client: SupabaseClient,
  seekerUserId: string,
): Promise<InterviewShareView[]> {
  const { data, error } = await client
    .from("meeting_interview_shares")
    .select(
      "id, meeting_schedule_id, encrypted_review_message, status, expires_at, created_at, meeting:meeting_schedules(title, starts_at, host_user_id, organization_id), recording:career_intake_recordings(original_filename, user_id)",
    )
    .eq("seeker_user_id", seekerUserId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listPendingSharesForSeeker failed: ${error.message}`);
  }
  const rows = (data ?? []).map((r) => {
    const meet = (r as { meeting: ShareRow["meeting"] | ShareRow["meeting"][] }).meeting;
    const rec = (r as { recording: ShareRow["recording"] | ShareRow["recording"][] }).recording;
    return {
      ...(r as Omit<ShareRow, "meeting" | "recording">),
      meeting: Array.isArray(meet) ? (meet[0] ?? null) : meet,
      recording: Array.isArray(rec) ? (rec[0] ?? null) : rec,
    };
  }) as ShareRow[];
  return Promise.all(rows.map((r) => rowToView(client, r)));
}

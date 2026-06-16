/**
 * 面談予約(meeting_schedules)の型定義
 *
 * DB の row 型(snake_case)と、UI / API で扱う view 型(camelCase)を
 * 分けて、間に shape 変換を挟む方針。
 */

export type MeetingProvider = "zoom" | "google_meet";

export type MeetingStatus = "scheduled" | "completed" | "canceled" | "no_show";

/** DB から SELECT したそのままの形 */
export type MeetingScheduleRow = {
  id: string;
  organization_id: string | null;
  host_user_id: string;
  client_record_id: string | null;
  seeker_user_id: string | null;
  invitee_email: string | null;
  provider: MeetingProvider;
  external_meeting_id: string;
  join_url: string;
  host_url: string | null;
  passcode: string | null;
  title: string;
  encrypted_agenda: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: MeetingStatus;
  invited_at: string | null;
  reminder_24h_sent_at: string | null;
  reminder_1h_sent_at: string | null;
  recording_id: string | null;
  created_at: string;
  updated_at: string;
};

/** UI / API レスポンスで扱う形(agenda は復号済み) */
export type MeetingScheduleView = {
  id: string;
  provider: MeetingProvider;
  title: string;
  agenda: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: MeetingStatus;
  joinUrl: string;
  hostUrl: string | null;
  passcode: string | null;
  // 相手
  clientRecordId: string | null;
  seekerUserId: string | null;
  inviteeEmail: string | null;
  // 録画
  recordingId: string | null;
  // タイムスタンプ
  invitedAt: string | null;
  reminder24hSentAt: string | null;
  reminder1hSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** API 入力(POST /api/agency/meetings) */
export type CreateMeetingInput = {
  provider: MeetingProvider;
  /** クライアントレコード ID(エージェント側で管理する求職者) */
  clientRecordId: string;
  /** タイトル(求職者にも見える) */
  title: string;
  /** 議題(機密、エージェント側のみが見る想定) */
  agenda?: string;
  /** ISO 8601(タイムゾーン情報を含めて渡す) */
  startsAt: string;
  /** 会議の長さ(分) */
  durationMinutes: number;
};

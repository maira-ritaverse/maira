/**
 * 面談予約(meeting_schedules)の DB アクセス層。
 *
 * - row → view 変換(agenda 復号)を集約
 * - 一覧 / 詳細 / 作成 / キャンセル の薄いラッパ
 * - Webhook / Cron からは service_role クライアント、API ルートからは
 *   ログインユーザのクライアントを渡せるよう、Supabase クライアントを
 *   引数で受け取る形にする
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField, encryptField } from "@/lib/crypto/field-encryption";

import type { CreateMeetingInput, MeetingScheduleRow, MeetingScheduleView } from "./types";

/** row → view 変換(agenda 復号) */
async function rowToView(row: MeetingScheduleRow): Promise<MeetingScheduleView> {
  const agenda = row.encrypted_agenda ? ((await decryptField(row.encrypted_agenda)) ?? "") : "";
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    agenda,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    status: row.status,
    joinUrl: row.join_url,
    hostUrl: row.host_url,
    passcode: row.passcode,
    clientRecordId: row.client_record_id,
    seekerUserId: row.seeker_user_id,
    inviteeEmail: row.invitee_email,
    recordingId: row.recording_id,
    invitedAt: row.invited_at,
    reminder24hSentAt: row.reminder_24h_sent_at,
    reminder1hSentAt: row.reminder_1h_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * meeting_schedules への INSERT 用パラメータ。
 * API ルート側で Zoom/Google から取得した external_meeting_id / join_url 等を
 * 用意してから呼ぶ。
 */
export type InsertMeetingScheduleParams = CreateMeetingInput & {
  organizationId: string | null;
  hostUserId: string;
  seekerUserId: string | null;
  inviteeEmail: string | null;
  externalMeetingId: string;
  joinUrl: string;
  hostUrl: string | null;
  passcode: string | null;
  endsAt: string;
  timezone: string;
};

export async function insertMeetingSchedule(
  client: SupabaseClient,
  params: InsertMeetingScheduleParams,
): Promise<MeetingScheduleView> {
  const encryptedAgenda = params.agenda ? await encryptField(params.agenda) : null;
  const { data, error } = await client
    .from("meeting_schedules")
    .insert({
      organization_id: params.organizationId,
      host_user_id: params.hostUserId,
      client_record_id: params.clientRecordId,
      seeker_user_id: params.seekerUserId,
      invitee_email: params.inviteeEmail,
      provider: params.provider,
      external_meeting_id: params.externalMeetingId,
      join_url: params.joinUrl,
      host_url: params.hostUrl,
      passcode: params.passcode,
      title: params.title,
      encrypted_agenda: encryptedAgenda,
      starts_at: params.startsAt,
      ends_at: params.endsAt,
      timezone: params.timezone,
      status: "scheduled",
    })
    .select()
    .single();
  if (error || !data) {
    throw new Error(`meeting_schedules insert failed: ${error?.message ?? "no data"}`);
  }
  return rowToView(data as MeetingScheduleRow);
}

/**
 * 1 件取得。 呼出 側 の 組織 ID を 必ず 渡す (defense-in-depth)。
 *
 * RLS で meeting_schedules は 自 org 分 のみ SELECT できる が、 将来 の RLS
 * regression / service_role client が 誤って 渡された 場合 に 他社 の 予定 を
 * 返さ ない よう に、 アプリ 側 でも organization_id フィルタ を 効かせる。
 * 他 の agency 系 PATCH / DELETE が すべて この pattern に なって おり、
 * それに 揃える (セキュリティ 監査 A6)。
 */
export async function getMeetingScheduleById(
  client: SupabaseClient,
  id: string,
  organizationId: string,
): Promise<MeetingScheduleView | null> {
  const { data, error } = await client
    .from("meeting_schedules")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`meeting_schedules get failed: ${error.message}`);
  if (!data) return null;
  return rowToView(data as MeetingScheduleRow);
}

/**
 * 主催者(エージェント本人)の今後の予定を新しい順に取得。
 * ダッシュボード / 設定画面用。
 */
export async function listUpcomingMeetingsForHost(
  client: SupabaseClient,
  hostUserId: string,
  options: { limit?: number; nowIso?: string } = {},
): Promise<MeetingScheduleView[]> {
  const now = options.nowIso ?? new Date().toISOString();
  const limit = options.limit ?? 20;
  const { data, error } = await client
    .from("meeting_schedules")
    .select("*")
    .eq("host_user_id", hostUserId)
    .gte("starts_at", now)
    .neq("status", "canceled")
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`meeting_schedules list failed: ${error.message}`);
  if (!data) return [];
  return Promise.all((data as MeetingScheduleRow[]).map(rowToView));
}

/**
 * 求職者(seeker_user_id)の今後の予定を新しい順に取得。
 * 求職者ダッシュボード「予定」セクション用。
 */
export async function listUpcomingMeetingsForSeeker(
  client: SupabaseClient,
  seekerUserId: string,
  options: { limit?: number; nowIso?: string } = {},
): Promise<MeetingScheduleView[]> {
  const now = options.nowIso ?? new Date().toISOString();
  const limit = options.limit ?? 5;
  const { data, error } = await client
    .from("meeting_schedules")
    .select("*")
    .eq("seeker_user_id", seekerUserId)
    .gte("starts_at", now)
    .neq("status", "canceled")
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`meeting_schedules seeker list failed: ${error.message}`);
  if (!data) return [];
  return Promise.all((data as MeetingScheduleRow[]).map(rowToView));
}

/**
 * 組織全体の面談予定を期間で取得(/agency/meetings 一覧ページ用)。
 *
 * - past=false:今後の予定(starts_at >= now)を昇順
 * - past=true :過去の予定(starts_at < now)を降順
 */
export async function listOrgMeetings(
  client: SupabaseClient,
  organizationId: string,
  options: { past?: boolean; limit?: number; nowIso?: string } = {},
): Promise<MeetingScheduleView[]> {
  const now = options.nowIso ?? new Date().toISOString();
  const limit = options.limit ?? 100;
  const past = options.past ?? false;
  const builder = client
    .from("meeting_schedules")
    .select("*")
    .eq("organization_id", organizationId);
  const filtered = past
    ? builder.lt("starts_at", now).order("starts_at", { ascending: false })
    : builder
        .gte("starts_at", now)
        .neq("status", "canceled")
        .order("starts_at", { ascending: true });
  const { data, error } = await filtered.limit(limit);
  if (error) throw new Error(`meeting_schedules org list failed: ${error.message}`);
  if (!data) return [];
  return Promise.all((data as MeetingScheduleRow[]).map(rowToView));
}

/**
 * 「次の面談」1 件(エージェント本人の主催で、開始まで N 時間以内)。
 * ダッシュボード / カレンダーヘッダー用。
 */
export async function getNextMeetingForHost(
  client: SupabaseClient,
  hostUserId: string,
  options: { withinHours?: number; nowIso?: string } = {},
): Promise<MeetingScheduleView | null> {
  const now = options.nowIso ?? new Date().toISOString();
  const within = options.withinHours ?? 24;
  const upper = new Date(new Date(now).getTime() + within * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("meeting_schedules")
    .select("*")
    .eq("host_user_id", hostUserId)
    .gte("starts_at", now)
    .lte("starts_at", upper)
    .neq("status", "canceled")
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`meeting_schedules next list failed: ${error.message}`);
  if (!data) return null;
  return rowToView(data as MeetingScheduleRow);
}

/**
 * クライアントレコードに紐づく面談履歴(古い順)。
 * クライアント詳細の「面談履歴」セクション用。
 */
export async function listMeetingsByClientRecord(
  client: SupabaseClient,
  clientRecordId: string,
): Promise<MeetingScheduleView[]> {
  const { data, error } = await client
    .from("meeting_schedules")
    .select("*")
    .eq("client_record_id", clientRecordId)
    .order("starts_at", { ascending: false });
  if (error) throw new Error(`meeting_schedules list by client failed: ${error.message}`);
  if (!data) return [];
  return Promise.all((data as MeetingScheduleRow[]).map(rowToView));
}

/**
 * ステータス更新ヘルパ(canceled / completed / no_show)。
 * UPDATE は RLS により host_user_id 一致 or 組織 admin のみ通る。
 */
export async function updateMeetingStatus(
  client: SupabaseClient,
  id: string,
  organizationId: string,
  status: MeetingScheduleRow["status"],
): Promise<void> {
  // M2 修正: 0 行 更新 (= RLS で 弾かれた / 別 host で 触れない) を silent success に
  // させ ない。 呼び 出し 元 は 事前 に host / admin 検証 して いる はず だ が、
  // 二重 防御 で 実 更新 の 行 数 を 確認 する。
  // A6 修正: organization_id を UPDATE フィルタ に 追加 (getMeetingScheduleById
  // と 揃える。 RLS regression 時 の 他社 データ 変更 を 防ぐ)。
  const { data, error } = await client
    .from("meeting_schedules")
    .update({ status })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("id");
  if (error) throw new Error(`meeting_schedules status update failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error("meeting_schedules status update matched 0 rows (RLS blocked or wrong id)");
  }
}

/**
 * 面談予定の再スケジュール / 内容変更。
 *
 * Zoom や Google 側の更新は別途呼び出し側で行い、本関数は DB の
 * 整合性を取るだけ。reminder_*_sent_at は変更後の新時刻に対しては
 * 改めて発火すべきなので NULL に戻す。
 */
export type ReschedulePatch = {
  title?: string;
  agenda?: string;
  startsAt?: string;
  endsAt?: string;
};

export async function rescheduleMeeting(
  client: SupabaseClient,
  id: string,
  organizationId: string,
  patch: ReschedulePatch,
): Promise<MeetingScheduleView> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.agenda !== undefined) {
    update.encrypted_agenda = patch.agenda ? await encryptField(patch.agenda) : null;
  }
  if (patch.startsAt !== undefined) update.starts_at = patch.startsAt;
  if (patch.endsAt !== undefined) update.ends_at = patch.endsAt;
  // 開始時刻が変わったらリマインダーは再発火対象
  if (patch.startsAt !== undefined) {
    update.reminder_24h_sent_at = null;
    update.reminder_1h_sent_at = null;
  }
  // A6 修正: organization_id を UPDATE フィルタ に 追加 (defense-in-depth)。
  const { data, error } = await client
    .from("meeting_schedules")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select()
    .single();
  if (error || !data) {
    throw new Error(`meeting_schedules reschedule failed: ${error?.message ?? "no data"}`);
  }
  return rowToView(data as MeetingScheduleRow);
}

/** invited_at / reminder_*_sent_at を更新するヘルパ */
export async function markMeetingInvited(
  client: SupabaseClient,
  id: string,
  at: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await client.from("meeting_schedules").update({ invited_at: at }).eq("id", id);
  if (error) throw new Error(`meeting_schedules invited mark failed: ${error.message}`);
}

export async function markReminderSent(
  client: SupabaseClient,
  id: string,
  kind: "24h" | "1h",
  at: string = new Date().toISOString(),
): Promise<void> {
  const column = kind === "24h" ? "reminder_24h_sent_at" : "reminder_1h_sent_at";
  const { error } = await client
    .from("meeting_schedules")
    .update({ [column]: at })
    .eq("id", id);
  if (error) throw new Error(`meeting_schedules reminder mark failed: ${error.message}`);
}

/** 録画取込み完了時に recording_id をバインド */
export async function bindMeetingRecording(
  client: SupabaseClient,
  meetingScheduleId: string,
  recordingId: string,
): Promise<void> {
  const { error } = await client
    .from("meeting_schedules")
    .update({ recording_id: recordingId, status: "completed" })
    .eq("id", meetingScheduleId);
  if (error) throw new Error(`meeting_schedules recording bind failed: ${error.message}`);
}

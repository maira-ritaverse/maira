/**
 * Zoom Cloud Recording から career_intake_recordings 行を「予約作成」するヘルパ。
 *
 * 流れ:
 *   1) Webhook の payload から host_id / account_id を取り出す
 *   2) zoom_connections で同じユーザを引き当てる
 *   3) 重複防止のため external_recording_id をユニークに扱う
 *   4) status='external_pending' で行を作成(storage_path は NULL)
 *   5) Pickup ジョブが download_url から取りに行く
 *
 * Webhook ハンドラは速度命なので、ここでは DB 行作成だけに留める。
 * 実際のダウンロード + 処理は Pickup endpoint 側に任せる。
 */
import { encryptField } from "@/lib/crypto/field-encryption";
import type { createServiceClient } from "@/lib/supabase/service";

export type ZoomRecordingFile = {
  id: string;
  download_url: string;
  file_type: string;
  recording_type?: string;
};

type ZoomRecordingPayload = {
  account_id?: string;
  object?: {
    uuid?: string;
    id?: string;
    host_id?: string;
    topic?: string;
    recording_files?: ZoomRecordingFile[];
  };
  download_token?: string; // V2 Webhook で付与される短期 token
};

export type IngestResult = {
  enqueued: number;
  skipped: number;
  reason?: string;
};

/**
 * 音声優先のファイルを 1 つ選ぶ(M4A → MP4 の順)。
 * Zoom は「audio_only / shared_screen_with_speaker_view」など複数生成するため、
 * 文字起こしは audio_only(M4A)を最優先。
 *
 * テスト容易性のため export。直接呼ぶ場面は zoom-ingest 内部限定。
 */
export function pickAudioFile(files: ZoomRecordingFile[]): ZoomRecordingFile | null {
  const audioOnly = files.find(
    (f) => f.recording_type === "audio_only" || /\.m4a$/i.test(f.download_url),
  );
  if (audioOnly) return audioOnly;
  // フォールバック:Speaker View MP4
  return files.find((f) => f.file_type?.toLowerCase() === "mp4") ?? null;
}

export async function enqueueZoomRecording(params: {
  service: ReturnType<typeof createServiceClient>;
  payload: ZoomRecordingPayload;
}): Promise<IngestResult> {
  const { service, payload } = params;
  const obj = payload.object;
  if (!obj || !obj.host_id) {
    return { enqueued: 0, skipped: 1, reason: "missing_host_id" };
  }
  const files = obj.recording_files ?? [];
  if (files.length === 0) {
    return { enqueued: 0, skipped: 1, reason: "no_files" };
  }
  const file = pickAudioFile(files);
  if (!file) {
    return { enqueued: 0, skipped: 1, reason: "no_audio_candidate" };
  }

  // host_id → ユーザ特定(zoom_user_id で照合)
  const { data: conn } = await service
    .from("zoom_connections")
    .select("user_id")
    .eq("zoom_user_id", obj.host_id)
    .maybeSingle();
  if (!conn) {
    return { enqueued: 0, skipped: 1, reason: "user_not_connected" };
  }

  // 重複防止:同じ external_recording_id が既にあればスキップ
  const { data: existing } = await service
    .from("career_intake_recordings")
    .select("id")
    .eq("external_source", "zoom")
    .eq("external_recording_id", file.id)
    .maybeSingle();
  if (existing) {
    return { enqueued: 0, skipped: 1, reason: "duplicate" };
  }

  // M1 修正: 従来 は `${url}?access_token=${token}` の 形 で 平文 保存 して いた が、
  // token は Zoom の bearer 相当 で 短命 と は いえ 平文 で 残す のは NG (CLAUDE.md
  // 「平文 を DB に 保存 しない」)。 URL 本体 は 平文 の まま、 token は 分離 して
  // AES-256-GCM で 暗号化 保存 する。 pickup 側 で 復号 し Authorization ヘッダ に 付ける。
  const downloadUrl = file.download_url;
  const encryptedDownloadToken = payload.download_token
    ? await encryptField(payload.download_token)
    : null;

  const userId = (conn as { user_id: string }).user_id;
  const filename = `${(obj.topic ?? "Zoom Meeting").slice(0, 60)}.${guessExt(file.file_type, file.download_url)}`;

  // ─── meeting_schedules への紐づけ判定 ──────────────────────────────
  // Myaira から予約した会議なら、meeting_schedules.external_meeting_id に obj.id が入る。
  // ヒットしたら transcript_purpose='agency_interview' + client_record_id をセットして、
  // 「エージェント面談録」として処理されるようにする。
  let meetingScheduleId: string | null = null;
  let clientRecordId: string | null = null;
  let transcriptPurpose: "self_intake" | "agency_interview" = "self_intake";

  const externalIdCandidate = obj.id ? String(obj.id) : null;
  if (externalIdCandidate) {
    const { data: ms } = await service
      .from("meeting_schedules")
      .select("id, client_record_id, host_user_id")
      .eq("provider", "zoom")
      .eq("external_meeting_id", externalIdCandidate)
      .maybeSingle();
    if (ms) {
      const row = ms as { id: string; client_record_id: string | null; host_user_id: string };
      meetingScheduleId = row.id;
      clientRecordId = row.client_record_id;
      transcriptPurpose = "agency_interview";
      // ホストと zoom_connections のユーザが一致するはず(別経路なら無視 = self_intake)
      if (row.host_user_id !== userId) {
        // host のミスマッチは異常系。安全側で agency_interview ではなく self_intake に戻す。
        meetingScheduleId = null;
        clientRecordId = null;
        transcriptPurpose = "self_intake";
      }
    }
  }

  const { data: inserted, error } = await service
    .from("career_intake_recordings")
    .insert({
      user_id: userId,
      storage_path: null,
      original_filename: filename,
      size_bytes: 0,
      status: "external_pending",
      external_source: "zoom",
      external_meeting_id: obj.uuid ?? obj.id ?? null,
      external_recording_id: file.id,
      external_download_url: downloadUrl,
      encrypted_download_token: encryptedDownloadToken,
      meeting_schedule_id: meetingScheduleId,
      client_record_id: clientRecordId,
      transcript_purpose: transcriptPurpose,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { enqueued: 0, skipped: 1, reason: `db_insert_failed: ${error?.message ?? "no data"}` };
  }

  // meeting_schedules 側に recording_id をバインドして status を completed に
  if (meetingScheduleId) {
    await service
      .from("meeting_schedules")
      .update({
        recording_id: (inserted as { id: string }).id,
        status: "completed",
      })
      .eq("id", meetingScheduleId);
  }

  return { enqueued: 1, skipped: 0 };
}

export function guessExt(fileType: string, url: string): string {
  const m = url.match(/\.([a-z0-9]{2,4})(?:\?|$)/i);
  if (m) return m[1].toLowerCase();
  return (fileType || "m4a").toLowerCase();
}

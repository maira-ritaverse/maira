/**
 * Google Drive 内の Meet 録画ファイルを検出して career_intake_recordings に enqueue する。
 *
 * Workspace の「Meet 録画 → Drive 自動保存」機能でアップロードされるファイルは
 * 一般に以下の特徴を持つ:
 *   ・MIME type:video/mp4(必要なら audio/m4a も)
 *   ・ファイル名:"Meet Recording" を含む(または `Meet 録画` の日本語)
 *   ・properties.recordingMimeType="MEET"(API では取得しづらいので名前ベースで判定)
 *
 * 実装方針:
 *   1) google_connections の last_drive_poll_at 以降に modifiedTime を持つ
 *      Meet 録画候補ファイルを Drive Files API で取得
 *   2) external_recording_id(file id)で重複チェック → 未取込なら enqueue
 *   3) ポーリング完了後に last_drive_poll_at を更新
 *
 * 注意:
 *   ・access_token は呼び出し側で取得済み前提
 *   ・enqueue 時の external_download_url は `https://www.googleapis.com/drive/v3/files/{id}?alt=media`
 *     形式。pickup 側で Authorization: Bearer ヘッダ付きで再取得する
 */
import type { createServiceClient } from "@/lib/supabase/service";

type Service = ReturnType<typeof createServiceClient>;

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
};

export type DriveMeetPollResult = {
  scanned: number;
  enqueued: number;
  skipped: number;
  reason?: string;
};

/**
 * 該当ユーザの Drive を polling して、新規 Meet 録画を enqueue する。
 */
export async function pollGoogleDriveForMeetRecordings(args: {
  service: Service;
  userId: string;
  accessToken: string;
  /** 前回ポーリング時刻(null なら 7 日前にデフォルト) */
  sinceIso: string | null;
}): Promise<DriveMeetPollResult> {
  const { service, userId, accessToken } = args;
  const since = args.sinceIso ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Drive 検索クエリ:
  //   - modifiedTime 以降
  //   - mimeType が video/mp4 or audio/m4a
  //   - ファイル名に "Meet" もしくは「録画」を含む
  //   - trashed=false
  const q = [
    `modifiedTime > '${since}'`,
    `(mimeType = 'video/mp4' or mimeType = 'audio/m4a')`,
    `(name contains 'Meet' or name contains '録画')`,
    `trashed = false`,
  ].join(" and ");

  const url = new URL(DRIVE_FILES_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,size)");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "modifiedTime desc");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive files.list failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { files?: DriveFile[] };
  const files = json.files ?? [];
  if (files.length === 0) {
    return { scanned: 0, enqueued: 0, skipped: 0, reason: "no_new_files" };
  }

  // 既存(取込済)を一括チェック
  const ids = files.map((f) => f.id);
  const { data: existingRows } = await service
    .from("career_intake_recordings")
    .select("external_recording_id")
    .eq("external_source", "google_drive")
    .in("external_recording_id", ids);
  const existingSet = new Set(
    (existingRows ?? []).map((r: { external_recording_id: string }) => r.external_recording_id),
  );

  let enqueued = 0;
  let skipped = 0;
  for (const f of files) {
    if (existingSet.has(f.id)) {
      skipped++;
      continue;
    }
    const downloadUrl = `${DRIVE_FILES_URL}/${encodeURIComponent(f.id)}?alt=media`;
    const ext = guessExtFromMime(f.mimeType);
    const filename = sanitizeFilename(f.name) + (ext ? `.${ext}` : "");

    // ─── meeting_schedules への紐づけ判定(時間窓ベース)──────────
    // Google Drive 録画はファイル名から元の Meet イベントを特定できない。
    // 暫定で「modifiedTime ± 4 時間以内に host=userId の Google Meet 予定」を
    // 探し、ヒットすれば紐づける。完全な紐づけは Phase 4 後段で別 API 経由に改善。
    let meetingScheduleId: string | null = null;
    let clientRecordId: string | null = null;
    let transcriptPurpose: "self_intake" | "agency_interview" = "self_intake";

    const win = 4 * 60 * 60 * 1000;
    const t = new Date(f.modifiedTime).getTime();
    if (!Number.isNaN(t)) {
      const lower = new Date(t - win).toISOString();
      const upper = new Date(t + win).toISOString();
      const { data: ms } = await service
        .from("meeting_schedules")
        .select("id, client_record_id")
        .eq("provider", "google_meet")
        .eq("host_user_id", userId)
        .gte("starts_at", lower)
        .lte("starts_at", upper)
        .is("recording_id", null)
        .order("starts_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (ms) {
        const row = ms as { id: string; client_record_id: string | null };
        meetingScheduleId = row.id;
        clientRecordId = row.client_record_id;
        transcriptPurpose = "agency_interview";
      }
    }

    const { data: inserted, error } = await service
      .from("career_intake_recordings")
      .insert({
        user_id: userId,
        storage_path: null,
        original_filename: filename || "Meet Recording",
        size_bytes: f.size ? Number(f.size) : 0,
        status: "external_pending",
        external_source: "google_drive",
        external_meeting_id: null,
        external_recording_id: f.id,
        external_download_url: downloadUrl,
        meeting_schedule_id: meetingScheduleId,
        client_record_id: clientRecordId,
        transcript_purpose: transcriptPurpose,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      skipped++;
      console.warn("[drive-meet-poll] insert failed", error?.message);
      continue;
    }

    if (meetingScheduleId) {
      await service
        .from("meeting_schedules")
        .update({
          recording_id: (inserted as { id: string }).id,
          status: "completed",
        })
        .eq("id", meetingScheduleId);
    }
    enqueued++;
  }

  // last_drive_poll_at 更新(直近 scan 終了時刻)
  await service
    .from("google_connections")
    .update({ last_drive_poll_at: new Date().toISOString() })
    .eq("user_id", userId);

  return { scanned: files.length, enqueued, skipped };
}

// テスト容易性のため export(直接呼ぶ場面は本ファイル内部限定)
export function guessExtFromMime(mime: string): string {
  if (mime === "video/mp4") return "mp4";
  if (mime === "audio/m4a") return "m4a";
  return "";
}

export function sanitizeFilename(name: string): string {
  // 既存拡張子は外して別途付与
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 80);
}

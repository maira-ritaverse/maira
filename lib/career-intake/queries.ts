/**
 * career_intake_recordings のクエリヘルパー
 *
 * 復号は呼び出し側で。本ファイルは行 → 型変換のみ。
 */
import { decryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

import {
  extractionResultSchema,
  type ExtractionResult,
  type IntakeRecording,
  type IntakeRecordingRow,
} from "./types";

/** 行を IntakeRecording に変換(transcript / extraction は復号する) */
export async function rowToRecording(row: IntakeRecordingRow): Promise<IntakeRecording> {
  const transcript = row.encrypted_transcript ? await decryptField(row.encrypted_transcript) : null;
  const extractionText = row.encrypted_extraction
    ? await decryptField(row.encrypted_extraction)
    : null;
  let extraction: ExtractionResult | null = null;
  if (extractionText) {
    try {
      const parsed = JSON.parse(extractionText);
      const validated = extractionResultSchema.safeParse(parsed);
      extraction = validated.success ? validated.data : null;
    } catch {
      extraction = null;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    status: row.status,
    statusMessage: row.status_message,
    transcript,
    extraction,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 自分の録音一覧(降順 createdAt、暗号文 / 復号両方ありえる) */
export async function listMyRecordings(): Promise<IntakeRecording[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("career_intake_recordings")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  return Promise.all((data as IntakeRecordingRow[]).map(rowToRecording));
}

/** 1 件取得(本人確認込) */
export async function getMyRecording(id: string): Promise<IntakeRecording | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("career_intake_recordings")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return rowToRecording(data as IntakeRecordingRow);
}

import { NextResponse } from "next/server";

import { notifyShareFromAgencyIntake } from "@/lib/career-intake/post-process";
import { runIntakeProcessing } from "@/lib/career-intake/process";
import { getGoogleAccessToken } from "@/lib/integrations/google-token";
import { getZoomAccessToken } from "@/lib/integrations/zoom-token";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/internal/career-intake/pickup
 *
 * バックグラウンドジョブの pickup エンドポイント。
 * Vercel Cron(vercel.json)から 5 分おきに叩かれる。
 *
 * 認証:
 *   ・X-Cron-Secret ヘッダか Authorization Bearer のいずれかで
 *     INTAKE_CRON_SECRET 突合(Vercel Cron は Authorization を付与する)
 *
 * 処理:
 *   1) status='external_pending'(Zoom 等から作成された未取込行)を 1 件 lock
 *      → external_download_url からダウンロード → Storage 保存 → status='uploaded'
 *   2) status='uploaded'(timeout で残ったものや external 由来)を 1 件 lock
 *      → Whisper + Claude → extracted
 *
 * 各 invocation で 1 件だけ進める(短時間で確実に終わるため)。
 * 詰まっていれば次の cron tick で次の 1 件。
 */

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 分
const STORAGE_BUCKET = "career-intake-audio";

type Service = ReturnType<typeof createServiceClient>;

function checkAuth(request: Request): boolean {
  const cronSecret = process.env.INTAKE_CRON_SECRET;
  if (!cronSecret) return false;
  const xCron = request.headers.get("x-cron-secret");
  if (xCron && xCron === cronSecret) return true;
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ") && auth.slice(7) === cronSecret) {
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  if (!process.env.INTAKE_CRON_SECRET) {
    return NextResponse.json(
      { error: "INTAKE_CRON_SECRET 未設定のため、本エンドポイントは無効化されています" },
      { status: 503 },
    );
  }
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Vercel Cron は GET でも呼べるよう、両方サポート(下の GET は POST にリダイレクト)
  const service = createServiceClient();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_DURATION_MS);

  // 1) まずは external_pending を 1 件処理する
  const externalDone = await pickAndProcessExternal(service, now, leaseUntil);
  if (externalDone.picked) {
    return NextResponse.json({ stage: "external", ...externalDone });
  }

  // 2) 次に uploaded を 1 件処理する
  const uploadedDone = await pickAndProcessUploaded(service, now, leaseUntil);
  return NextResponse.json({ stage: "uploaded", ...uploadedDone });
}

// Vercel Cron は GET を送る場合がある。シンプルに同じハンドラを呼ぶ。
export const GET = POST;

// ─────────────────────────────────────────────────────────────────
// external_pending → ダウンロード → Storage → uploaded
// ─────────────────────────────────────────────────────────────────
async function pickAndProcessExternal(
  service: Service,
  now: Date,
  leaseUntil: Date,
): Promise<{ picked: number; ok?: boolean; id?: string; message?: string }> {
  const { data: candidate } = await service
    .from("career_intake_recordings")
    .select("id")
    .eq("status", "external_pending")
    .or(`processing_lease_until.is.null,processing_lease_until.lt.${now.toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return { picked: 0 };
  const candidateId = (candidate as { id: string }).id;

  const { data: locked } = await service
    .from("career_intake_recordings")
    .update({
      processing_started_at: now.toISOString(),
      processing_lease_until: leaseUntil.toISOString(),
    })
    .eq("id", candidateId)
    .eq("status", "external_pending")
    .select(
      "id, user_id, original_filename, external_download_url, external_source, transcript_purpose",
    )
    .maybeSingle();
  if (!locked) return { picked: 0, message: "race" };
  const rec = locked as {
    id: string;
    user_id: string;
    original_filename: string;
    external_download_url: string | null;
    external_source: string | null;
    transcript_purpose: "self_intake" | "agency_interview" | null;
  };

  if (!rec.external_download_url) {
    await markFailed(service, rec.id, "transcribe", "external_download_url 欠落");
    return { picked: 1, ok: false, id: rec.id };
  }

  // ダウンロード(Zoom は webhook で発行された download_token が短期失効するため、
  // 失効後は access_token を refresh して Authorization ヘッダで再試行する)
  let blob: Blob;
  try {
    blob = await downloadExternal({
      service,
      url: rec.external_download_url,
      source: rec.external_source,
      userId: rec.user_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(service, rec.id, "transcribe", `ダウンロード失敗: ${msg}`);
    return { picked: 1, ok: false, id: rec.id };
  }

  // Storage に保存
  const ext = guessExt(rec.original_filename);
  const storagePath = `${rec.user_id}/${rec.id}.${ext}`;
  const { error: upErr } = await service.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, blob, { upsert: true, contentType: blob.type || "audio/m4a" });
  if (upErr) {
    await markFailed(service, rec.id, "transcribe", `Storage 保存失敗: ${upErr.message}`);
    return { picked: 1, ok: false, id: rec.id };
  }

  // status を uploaded に上げて、本 invocation でそのまま処理に進む
  await service
    .from("career_intake_recordings")
    .update({
      status: "uploaded",
      storage_path: storagePath,
      size_bytes: blob.size,
      processing_lease_until: leaseUntil.toISOString(),
    })
    .eq("id", rec.id);

  // 続けて文字起こし + 抽出を実行(同じレースで)
  return await processUploadedRow(service, {
    id: rec.id,
    user_id: rec.user_id,
    storage_path: storagePath,
    original_filename: rec.original_filename,
    transcript_purpose: rec.transcript_purpose,
  });
}

// ─────────────────────────────────────────────────────────────────
// uploaded → Whisper → Claude → extracted
// ─────────────────────────────────────────────────────────────────
async function pickAndProcessUploaded(
  service: Service,
  now: Date,
  leaseUntil: Date,
): Promise<{ picked: number; ok?: boolean; id?: string; message?: string }> {
  const { data: candidate } = await service
    .from("career_intake_recordings")
    .select("id")
    .eq("status", "uploaded")
    .or(`processing_lease_until.is.null,processing_lease_until.lt.${now.toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return { picked: 0 };
  const candidateId = (candidate as { id: string }).id;

  const { data: locked } = await service
    .from("career_intake_recordings")
    .update({
      processing_started_at: now.toISOString(),
      processing_lease_until: leaseUntil.toISOString(),
      status: "transcribing",
    })
    .eq("id", candidateId)
    .eq("status", "uploaded")
    .select("id, user_id, storage_path, original_filename, transcript_purpose")
    .maybeSingle();
  if (!locked) return { picked: 0, message: "race" };
  return await processUploadedRow(service, locked as RowForProcess);
}

type RowForProcess = {
  id: string;
  user_id: string;
  storage_path: string | null;
  original_filename: string;
  /** Phase 4 で追加。null/undefined のときは self_intake 扱い(後方互換) */
  transcript_purpose?: "self_intake" | "agency_interview" | null;
};

async function processUploadedRow(
  service: Service,
  rec: RowForProcess,
): Promise<{ picked: number; ok: boolean; id: string; message?: string }> {
  if (!rec.storage_path) {
    await markFailed(service, rec.id, "transcribe", "storage_path が空です");
    return { picked: 1, ok: false, id: rec.id };
  }
  const { data: file, error: dlErr } = await service.storage
    .from(STORAGE_BUCKET)
    .download(rec.storage_path);
  if (dlErr || !file) {
    await markFailed(
      service,
      rec.id,
      "transcribe",
      `Storage 取得失敗: ${dlErr?.message ?? "unknown"}`,
    );
    return { picked: 1, ok: false, id: rec.id };
  }

  const result = await runIntakeProcessing({
    audio: file,
    filename: rec.original_filename,
    purpose: rec.transcript_purpose === "agency_interview" ? "agency_interview" : "self_intake",
  });

  if (!result.ok) {
    if (result.encryptedTranscript) {
      await service
        .from("career_intake_recordings")
        .update({ encrypted_transcript: result.encryptedTranscript })
        .eq("id", rec.id);
    }
    await markFailed(service, rec.id, result.stage, result.message);
    return { picked: 1, ok: false, id: rec.id, message: result.message };
  }

  await service
    .from("career_intake_recordings")
    .update({
      status: "extracted",
      encrypted_transcript: result.encryptedTranscript,
      encrypted_extraction: result.encryptedExtraction,
      status_message: null,
      processing_lease_until: null,
    })
    .eq("id", rec.id);

  // agency_interview の場合は求職者にレビュー依頼を自動送信
  try {
    await notifyShareFromAgencyIntake({ service, recordingId: rec.id });
  } catch {
    // 失敗してもパイプライン全体は成功扱い(後で再試行ジョブを足すか手動で fallback)
  }

  return { picked: 1, ok: true, id: rec.id };
}

async function markFailed(
  service: Service,
  id: string,
  stage: "transcribe" | "extract",
  message: string,
) {
  await service
    .from("career_intake_recordings")
    .update({
      status: stage === "transcribe" ? "failed_transcribe" : "failed_extract",
      status_message: message,
      processing_lease_until: null,
    })
    .eq("id", id);
}

function guessExt(filename: string): string {
  const m = filename.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : "m4a";
}

/**
 * 外部ソース由来の URL からファイルをダウンロードする。
 *   - Zoom:short-lived download_token 切れに備え、401/403 で access_token を refresh して再試行
 *   - Google Drive:常に Authorization: Bearer 必須なので、最初から refresh-aware に取得
 */
async function downloadExternal(args: {
  service: Service;
  url: string;
  source: string | null;
  userId: string;
}): Promise<Blob> {
  // Google Drive は最初から Bearer 必須
  if (args.source === "google_drive") {
    const token = await getGoogleAccessToken({ service: args.service, userId: args.userId });
    const res = await fetch(args.url, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive download failed HTTP ${res.status}`);
    return await res.blob();
  }

  // それ以外:まずは素のまま
  const first = await fetch(args.url);
  if (first.ok) return await first.blob();

  // Zoom の 401 / 403 だったら refresh して Authorization ヘッダ付きで再試行
  if (args.source === "zoom" && (first.status === 401 || first.status === 403)) {
    const token = await getZoomAccessToken({ service: args.service, byUserId: args.userId });
    const retry = await fetch(args.url, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (retry.ok) return await retry.blob();
    throw new Error(`Zoom 再試行も失敗 HTTP ${retry.status}`);
  }
  throw new Error(`HTTP ${first.status}`);
}

import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { runIntakeProcessing } from "@/lib/career-intake/process";
import { checkIntakeLimit } from "@/lib/features/usage-limits";

/**
 * POST /api/career-intake/recordings
 *
 * 音声/動画ファイル(multipart/form-data の field "file")をアップロード。
 * 同期処理で:
 *   1) Supabase Storage に保存(private bucket "career-intake-audio")
 *   2) DB に行を作成
 *   3) Whisper で文字起こし
 *   4) Claude で構造化抽出(JSON)
 *   5) 結果を暗号化して DB 更新
 *
 * 状態:
 *   uploaded → transcribing → transcribed → extracting → extracted
 *
 * 制限:
 *   - 25 MiB(Whisper 単一リクエスト上限と同じ)
 *   - 単発処理で 60 秒以内を期待(Vercel Pro)。長すぎる場合は失敗ステータスを残す
 *
 * GET は未実装(履歴は SSR 取得が中心。必要なら lib/career-intake/queries で対応)。
 */

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/m4a",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 月次回数制限チェック(基本プラン: フリー枠 / アドオン契約者: 拡張枠)
  // ここで先に弾くことで Storage / Whisper / Claude のコストを無駄にしない。
  const limit = await checkIntakeLimit(supabase, user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "intake_limit_exceeded",
        message: limit.addon
          ? `今月のアップロード上限(${limit.limit} 件)に達しました。来月までお待ちください。`
          : `今月のアップロード上限(${limit.limit} 件)に達しました。「会議録音 自動連携」アドオンを追加すると上限が拡張されます。`,
        usage: {
          current: limit.current,
          limit: limit.limit,
          addon: limit.addon,
          resetsAt: limit.resetsAt,
        },
      },
      { status: 402 },
    );
  }

  // multipart/form-data 受け取り
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `ファイルが大きすぎます(最大 ${MAX_BYTES / 1024 / 1024} MiB)` },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `非対応のファイル形式です(MIME: ${file.type})` },
      { status: 415 },
    );
  }
  const filename = (form.get("filename") as string | null) ?? `recording-${Date.now()}`;

  // 1) Storage パスを決める(user_id/{uuid}.{ext})
  // crypto.randomUUID() は Edge/Node 両方で使える
  const recordingId = crypto.randomUUID();
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "bin";
  const storagePath = `${user.id}/${recordingId}.${ext}`;

  // 2) Storage にアップロード
  const { error: upErr } = await supabase.storage
    .from("career-intake-audio")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: "Storage upload failed", message: upErr.message },
      { status: 500 },
    );
  }

  // 3) DB 行を作成(uploaded 状態)
  const { error: insErr } = await supabase.from("career_intake_recordings").insert({
    id: recordingId,
    user_id: user.id,
    storage_path: storagePath,
    original_filename: filename,
    size_bytes: file.size,
    status: "uploaded",
  });
  if (insErr) {
    // Storage に上げたファイルを掃除
    await supabase.storage.from("career-intake-audio").remove([storagePath]);
    return NextResponse.json(
      { error: "DB insert failed", message: insErr.message },
      { status: 500 },
    );
  }

  // ────────────────────────────────────────────
  // 4-5) 文字起こし + Claude 抽出(共通パイプライン)
  // ────────────────────────────────────────────
  await supabase
    .from("career_intake_recordings")
    .update({ status: "transcribing" })
    .eq("id", recordingId);

  const result = await runIntakeProcessing({ audio: file, filename });

  if (!result.ok) {
    const finalStatus = result.stage === "transcribe" ? "failed_transcribe" : "failed_extract";
    await supabase
      .from("career_intake_recordings")
      .update({
        status: finalStatus,
        status_message: result.message,
        encrypted_transcript: result.encryptedTranscript ?? null,
      })
      .eq("id", recordingId);
    return NextResponse.json(
      { id: recordingId, status: finalStatus, message: result.message },
      { status: 502 },
    );
  }

  await supabase
    .from("career_intake_recordings")
    .update({
      status: "extracted",
      encrypted_transcript: result.encryptedTranscript,
      encrypted_extraction: result.encryptedExtraction,
      status_message: null,
    })
    .eq("id", recordingId);

  return NextResponse.json({ id: recordingId, status: "extracted" });
}

import { NextResponse } from "next/server";
import { generateText } from "ai";

import { requireUser } from "@/lib/api/auth-guards";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { getModel, MODELS } from "@/lib/ai/client";
import { CAREER_INTAKE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts/career-intake-extraction";
import { extractJsonFromText } from "@/lib/career-intake/extract-json";
import { transcribeWithWhisper } from "@/lib/career-intake/transcribe";
import { extractionResultSchema } from "@/lib/career-intake/types";

/**
 * POST /api/career-intake/recordings/[id]/retry
 *
 * 失敗状態(failed_transcribe / failed_extract)の録音を再処理。
 * - failed_extract:既存の文字起こしから Claude 抽出だけ再実行
 * - failed_transcribe:Storage から音声を取り直して Whisper → Claude を実行
 *
 * 本人のみ。RLS でも保護されるが explicit に user_id でも絞る。
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const { data: row } = await supabase
    .from("career_intake_recordings")
    .select("id, status, storage_path, original_filename, encrypted_transcript")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rec = row as {
    id: string;
    status: string;
    storage_path: string;
    original_filename: string;
    encrypted_transcript: string | null;
  };

  if (rec.status !== "failed_transcribe" && rec.status !== "failed_extract") {
    return NextResponse.json(
      { error: `現在のステータス(${rec.status})からは再処理できません` },
      { status: 409 },
    );
  }

  // failed_extract の場合は既存の文字起こしを再利用できる
  let transcript: string | null = null;
  if (rec.status === "failed_extract" && rec.encrypted_transcript) {
    transcript = await decryptField(rec.encrypted_transcript);
  }

  if (!transcript) {
    // failed_transcribe または transcript が失われた場合:Storage から音声を取り直して再転写
    await supabase
      .from("career_intake_recordings")
      .update({ status: "transcribing", status_message: null })
      .eq("id", id);

    const { data: file, error: downErr } = await supabase.storage
      .from("career-intake-audio")
      .download(rec.storage_path);
    if (downErr || !file) {
      const msg = `Storage から音声を取得できませんでした:${downErr?.message ?? "unknown"}`;
      await supabase
        .from("career_intake_recordings")
        .update({ status: "failed_transcribe", status_message: msg })
        .eq("id", id);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const t = await transcribeWithWhisper({
      audio: file,
      filename: rec.original_filename,
      language: "ja",
    });
    if (!t.ok) {
      const msg =
        t.reason === "not_configured"
          ? "OPENAI_API_KEY が未設定です"
          : (t.error ?? "文字起こしに失敗しました");
      await supabase
        .from("career_intake_recordings")
        .update({ status: "failed_transcribe", status_message: msg })
        .eq("id", id);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const encryptedTranscript = await encryptField(t.text);
    await supabase
      .from("career_intake_recordings")
      .update({
        status: "transcribed",
        encrypted_transcript: encryptedTranscript ?? null,
        status_message: null,
      })
      .eq("id", id);
    transcript = t.text;
  }

  // 抽出フェーズ
  await supabase
    .from("career_intake_recordings")
    .update({ status: "extracting", status_message: null })
    .eq("id", id);

  try {
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system: CAREER_INTAKE_EXTRACTION_SYSTEM_PROMPT,
      prompt: `以下のキャリア面談文字起こしから、指定 JSON 構造で抽出してください。\n\n${transcript}`,
    });
    const jsonText = extractJsonFromText(result.text.trim());
    const parsed = JSON.parse(jsonText) as unknown;
    const validated = extractionResultSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`抽出スキーマ検証失敗: ${validated.error.message.slice(0, 200)}`);
    }
    const encrypted = await encryptField(JSON.stringify(validated.data));
    await supabase
      .from("career_intake_recordings")
      .update({
        status: "extracted",
        encrypted_extraction: encrypted ?? null,
        status_message: null,
      })
      .eq("id", id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("career_intake_recordings")
      .update({ status: "failed_extract", status_message: msg })
      .eq("id", id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}

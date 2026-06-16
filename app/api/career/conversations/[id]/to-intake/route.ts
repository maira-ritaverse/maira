import { NextResponse } from "next/server";
import { generateText } from "ai";

import { requireUser } from "@/lib/api/auth-guards";
import { encryptField } from "@/lib/crypto/field-encryption";
import { getModel, MODELS } from "@/lib/ai/client";
import { CAREER_INTAKE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts/career-intake-extraction";
import { extractJsonFromText } from "@/lib/career-intake/extract-json";
import { extractionResultSchema } from "@/lib/career-intake/types";
import { getMessages, verifyConversationOwner } from "@/lib/career/conversations";

/**
 * POST /api/career/conversations/[id]/to-intake
 *
 * キャリア棚卸し対話を「面談録音」と同じ extraction パイプラインにかけ、
 * career_intake_recordings に extracted 状態の擬似録音を作る。
 *
 * - 本人のみ(verifyConversationOwner で確認)
 * - 音声ファイルは存在しないので storage_path は "conversation:<conv_id>" 形式の
 *   ダミー文字列(Storage 上にファイルは作らない)
 * - 文字起こし扱いとして「user: ... / assistant: ...」を行頭付きで結合した
 *   テキストを保存(暗号化)
 * - そのあと Claude で抽出 → JSON を暗号化保存
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { id: conversationId } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const isOwner = await verifyConversationOwner(conversationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await getMessages(conversationId);
  if (messages.length < 2) {
    return NextResponse.json({ error: "対話の内容が短すぎます(2 発話以上必要)" }, { status: 400 });
  }

  // ユーザ発話だけだと文脈が薄いので、両者を含めて整形する。
  const transcript = messages
    .map((m) => {
      const role = m.role === "user" ? "あなた" : "面接官 AI";
      return `${role}: ${m.content}`;
    })
    .join("\n\n");

  // 擬似録音レコードを作成(uploaded → extracting → extracted の流れ)
  const recordingId = crypto.randomUUID();
  const fakeFilename = `キャリア棚卸し対話 ${conversationId.slice(0, 8)}.txt`;
  const fakeStoragePath = `conversation:${conversationId}`;

  const encryptedTranscript = await encryptField(transcript);

  const { error: insErr } = await supabase.from("career_intake_recordings").insert({
    id: recordingId,
    user_id: user.id,
    storage_path: fakeStoragePath,
    original_filename: fakeFilename,
    size_bytes: transcript.length,
    status: "extracting",
    encrypted_transcript: encryptedTranscript ?? null,
    status_message: "キャリア棚卸し対話から作成",
  });
  if (insErr) {
    return NextResponse.json(
      { error: "DB insert failed", message: insErr.message },
      { status: 500 },
    );
  }

  // Claude 抽出
  try {
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system: CAREER_INTAKE_EXTRACTION_SYSTEM_PROMPT,
      prompt: `以下のキャリアコンサルタントと求職者の対話から、指定 JSON 構造で抽出してください。\n\n${transcript}`,
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
        status_message: "キャリア棚卸し対話から作成",
      })
      .eq("id", recordingId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("career_intake_recordings")
      .update({ status: "failed_extract", status_message: msg })
      .eq("id", recordingId);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({ recordingId, success: true });
}

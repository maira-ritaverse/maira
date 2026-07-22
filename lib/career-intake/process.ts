/**
 * 文字起こし → AI 抽出 → 暗号化保存の共通パイプライン。
 *
 * 元々 POST /api/career-intake/recordings と pickup ルートに重複していたロジックを集約。
 * Zoom / Google 自動取込からも呼び出すため lib に切り出した。
 *
 * 呼び出し前の前提:
 *   ・career_intake_recordings 行は既に作成済み
 *   ・storage_path もしくは audioBlob のいずれかが用意済み
 *
 * 戻り値:
 *   { ok: true, finalStatus: 'extracted' } もしくは
 *   { ok: false, finalStatus: 'failed_*', message }
 *
 * DB 更新は呼び出し側で行う設計(service / anon 両クライアントで動かしたい)。
 * 本関数は副作用が無い「変換」だけを行う。
 */
import { generateText } from "ai";

import { AGENCY_INTERVIEW_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts/agency-interview-extraction";
import { CAREER_INTAKE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/prompts/career-intake-extraction";
import { getModel, MODELS } from "@/lib/ai/client";
import { encryptField } from "@/lib/crypto/field-encryption";

import { extractJsonFromText } from "./extract-json";
import { transcribeWithWhisper } from "./transcribe";
import { extractionResultSchema } from "./types";

export type PipelineResult =
  | {
      ok: true;
      encryptedTranscript: string;
      encryptedExtraction: string;
      transcriptText: string;
    }
  | {
      ok: false;
      stage: "transcribe" | "extract";
      message: string;
      // 失敗が transcribe より後だったら、復元用に transcript も返す
      encryptedTranscript?: string;
    };

export type IntakePurpose = "self_intake" | "agency_interview";

// Whisper は「無音・発話が無い音声」に対して、学習データ由来の定型句を大量に
// ハルシネーション(幻聴)する。日本語では「ご視聴ありがとうございました」が代表例で、
// これが並ぶ文字起こしは実質「発話なし」。空の書類を黙って作らずエラーで止めるための検出。
const WHISPER_NOSPEECH_PHRASES = [
  "最後までご視聴いただきありがとうございました",
  "ご視聴いただきありがとうございました",
  "ご視聴ありがとうございました",
  "チャンネル登録をお願いします",
  "チャンネル登録よろしくお願いします",
  "ありがとうございました",
  "おやすみなさい",
  "バイバイ",
];

/**
 * 文字起こしが「無発話(無音ハルシネーション or ほぼ空)」かどうかを判定する。
 * 既知のハルシネーション定型句を除いた「実内容」が極端に少なければ無発話とみなす。
 */
export function looksLikeNoSpeech(text: string): boolean {
  const compact = text.replace(/[\s　、。!?！？]/g, "");
  if (compact.length < 12) return true; // ほぼ空
  let stripped = compact;
  for (const p of WHISPER_NOSPEECH_PHRASES) {
    stripped = stripped.split(p.replace(/[\s　、。]/g, "")).join("");
  }
  return stripped.length < 40 && stripped.length / compact.length < 0.15;
}

export async function runIntakeProcessing(params: {
  audio: Blob;
  filename: string;
  /** 抽出 system prompt の出し分け。既定は本人モード(後方互換) */
  purpose?: IntakePurpose;
}): Promise<PipelineResult> {
  // 1) 文字起こし。冒頭の無音での定型句ハルシネーションを抑えるため、用途に応じた
  //    文脈プロンプトを渡す(gpt-4o-transcribe 優先 / whisper-1 fallback は transcribe 側)。
  const t = await transcribeWithWhisper({
    audio: params.audio,
    filename: params.filename,
    language: "ja",
    prompt:
      params.purpose === "agency_interview"
        ? "これはキャリアアドバイザー(エージェント)と求職者による転職相談・キャリア面談の録音です。求職者が自身の職務経歴・スキル・転職理由・希望条件を話します。"
        : "これは求職者本人によるキャリアの棚卸し・自己紹介の録音です。職務経歴・スキル・希望条件を話します。",
  });
  if (!t.ok) {
    const msg =
      t.reason === "not_configured"
        ? "OPENAI_API_KEY が未設定です。"
        : (t.error ?? "文字起こしに失敗しました");
    return { ok: false, stage: "transcribe", message: msg };
  }
  const encryptedTranscript = await encryptField(t.text);
  if (!encryptedTranscript) {
    return { ok: false, stage: "transcribe", message: "暗号化に失敗しました" };
  }

  // 無音 / 発話なし(Whisper のハルシネーション)を検出したら、空の書類を作らず
  // ここで明確に失敗させる。文字起こしは保存しておく(確認ビューで中身が見えるように)。
  if (looksLikeNoSpeech(t.text)) {
    return {
      ok: false,
      stage: "transcribe",
      message:
        "音声から発話を認識できませんでした(無音・極端に小さい音声・発話の入っていない録音の可能性)。マイク / 音量 / 録音形式をご確認のうえ、もう一度お試しください。",
      encryptedTranscript,
    };
  }

  // 2) Claude 抽出(purpose で system prompt を切り替え)
  const systemPrompt =
    params.purpose === "agency_interview"
      ? AGENCY_INTERVIEW_EXTRACTION_SYSTEM_PROMPT
      : CAREER_INTAKE_EXTRACTION_SYSTEM_PROMPT;
  const promptIntro =
    params.purpose === "agency_interview"
      ? "以下のエージェント面談文字起こしから、求職者本人の発言を中心に、指定 JSON 構造で抽出してください。"
      : "以下のキャリア面談文字起こしから、指定 JSON 構造で抽出してください。";
  try {
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system: systemPrompt,
      prompt: `${promptIntro}\n\n${t.text}`,
    });
    const jsonText = extractJsonFromText(result.text.trim());
    const parsed = JSON.parse(jsonText) as unknown;
    const validated = extractionResultSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        stage: "extract",
        message: `抽出スキーマ検証失敗: ${validated.error.message.slice(0, 200)}`,
        encryptedTranscript,
      };
    }
    const encryptedExtraction = await encryptField(JSON.stringify(validated.data));
    if (!encryptedExtraction) {
      return {
        ok: false,
        stage: "extract",
        message: "抽出結果の暗号化に失敗しました",
        encryptedTranscript,
      };
    }
    return {
      ok: true,
      encryptedTranscript,
      encryptedExtraction,
      transcriptText: t.text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, stage: "extract", message: msg, encryptedTranscript };
  }
}

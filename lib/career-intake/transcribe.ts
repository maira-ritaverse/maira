/**
 * Whisper API による音声文字起こしラッパー
 *
 * 採用理由:
 *   - OpenAI Whisper(whisper-1)が日本語の文字起こし品質と速度のバランスが良い
 *   - 単一リクエスト 25 MiB 上限。本機能の入口で同じ制限を強制する
 *   - 認証は OPENAI_API_KEY(環境変数、Vercel で管理)
 *
 * 注意:
 *   - サーバ専用(API キーをクライアントに渡さない)
 *   - 失敗時はメッセージを返し、呼び出し側で recordings.status を failed_transcribe に
 */

export type TranscribeArgs = {
  /** 音声/動画ファイルのバイト列(Storage から取得 or 直接アップロード) */
  audio: Blob;
  /** 表示用ファイル名(MIME や拡張子の補助) */
  filename: string;
  /** 期待言語(指定しなければ自動検出。日本語に固定して品質を上げる) */
  language?: string;
  /**
   * 文脈プロンプト。無音区間での定型句ハルシネーション(「ご視聴ありがとうございました」等)を
   * 抑えるため、冒頭に想定文脈を与える。
   */
  prompt?: string;
};

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "failed"; error?: string };

type CallResult = { ok: true; text: string } | { ok: false; error: string };

/** OpenAI transcription API を 1 モデルで呼ぶ。json/text どちらのレスポンス形式にも対応。 */
async function callTranscription(
  apiKey: string,
  args: TranscribeArgs,
  model: string,
  responseFormat: "json" | "text",
): Promise<CallResult> {
  const form = new FormData();
  form.append("file", args.audio, args.filename);
  form.append("model", model);
  form.append("language", args.language ?? "ja");
  form.append("response_format", responseFormat);
  if (args.prompt) form.append("prompt", args.prompt);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status} (${model}): ${detail.slice(0, 300)}` };
  }
  if (responseFormat === "json") {
    const body = (await res.json().catch(() => null)) as { text?: string } | null;
    return { ok: true, text: (body?.text ?? "").trim() };
  }
  return { ok: true, text: (await res.text()).trim() };
}

/**
 * 文字起こし。ハルシネーションに強い gpt-4o-transcribe を優先し、使えない/エラー時は
 * 従来の whisper-1 に自動フォールバックする(fallback は現行挙動そのままなので回帰なし)。
 * 冒頭の長い無音が「ご視聴ありがとうございました」等の幻聴を誘発する既知問題への対策。
 */
export async function transcribeWithWhisper(args: TranscribeArgs): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  // 1) gpt-4o-transcribe(json)を優先
  try {
    const primary = await callTranscription(apiKey, args, "gpt-4o-transcribe", "json");
    if (primary.ok) return { ok: true, text: primary.text };
  } catch {
    // ネットワーク等の例外は fallback に回す
  }

  // 2) fallback: whisper-1(従来どおり text)
  try {
    const fb = await callTranscription(apiKey, args, "whisper-1", "text");
    if (fb.ok) return { ok: true, text: fb.text };
    return { ok: false, reason: "failed", error: fb.error };
  } catch (err) {
    return { ok: false, reason: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

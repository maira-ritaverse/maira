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
};

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "failed"; error?: string };

export async function transcribeWithWhisper(args: TranscribeArgs): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured" };
  }

  const form = new FormData();
  form.append("file", args.audio, args.filename);
  form.append("model", "whisper-1");
  form.append("language", args.language ?? "ja");
  // response_format = text にすると単純な text body が返る(JSON.parse 不要)
  form.append("response_format", "text");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        reason: "failed",
        error: `HTTP ${res.status}: ${detail.slice(0, 500)}`,
      };
    }

    const text = await res.text();
    return { ok: true, text: text.trim() };
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

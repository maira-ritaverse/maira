/**
 * 求職者 の 元書類 (PDF / 画像) から client_records プロフィール項目 を
 * 抽出する 純粋 ヘルパ。
 *
 * 副作用なし (認証 / クォータ / DB 書き込み は route.ts 側 で 行う)。
 * テスト や 内部 スクリプト から 直接 呼べる ように 分離。
 *
 * 採用 モデル: claude-sonnet-4-6 (Vision 対応)
 * 対応 ファイル: application/pdf, image/png, image/jpeg, image/webp
 *
 * 実装 方針 は lib/jobs/ai-extract.ts と 同型:
 *   ・generateText で JSON 出力 を 指示 → extractJsonFromText → zod 検証
 *   ・失敗 時 は reason タグ 付き で 呼び出し 側 に 返す (throw しない)
 *
 * 100% 信頼 できる 抽出 は 不可能 な ので、 戻り値 の `confidence`(high/medium/low)
 * を UI で 「読み取り 精度」 として 表示 する。
 */
import { generateText } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";
import { extractJsonFromText } from "@/lib/career-intake/extract-json";
import {
  CLIENT_EXTRACTION_SYSTEM_PROMPT,
  CLIENT_EXTRACTION_USER_PROMPT,
  clientExtractionSchema,
  type ClientExtractionResult,
} from "@/lib/ai/prompts/client-extract-from-document";

/** ブラウザ から 受け取る 添付 ファイル の 最大 サイズ (10 MB)。 求人抽出 と 同値。 */
export const CLIENT_EXTRACT_MAX_BYTES = 10 * 1024 * 1024;

export const CLIENT_EXTRACT_SUPPORTED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type ClientExtractMime = (typeof CLIENT_EXTRACT_SUPPORTED_MIME)[number];

export function isSupportedClientExtractMime(mime: string): mime is ClientExtractMime {
  return (CLIENT_EXTRACT_SUPPORTED_MIME as readonly string[]).includes(mime);
}

export type ExtractClientInput = {
  /** PDF / 画像 の バイナリ。 AI SDK は Uint8Array / Buffer / Blob を 受け付ける。 */
  data: Uint8Array;
  /** application/pdf, image/png 等。 */
  mimeType: ClientExtractMime;
};

export type ExtractClientOutput =
  | { ok: true; result: ClientExtractionResult }
  | { ok: false; reason: "ai_error"; message: string }
  | { ok: false; reason: "schema_error"; message: string };

/**
 * Claude Sonnet 4.6 に PDF / 画像 を 添付 して 構造化 抽出 を 依頼 する。
 *
 * AI SDK v6 の messages 形式 で multimodal を 渡す。 Anthropic は ネイティブ で
 * application/pdf を 受け取れる ので、 サーバー側 で 画像化 する 必要 は ない。
 */
export async function extractClientFromDocument(
  input: ExtractClientInput,
): Promise<ExtractClientOutput> {
  let rawText = "";
  try {
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system: CLIENT_EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: input.data,
              mediaType: input.mimeType,
            },
            {
              type: "text",
              text: CLIENT_EXTRACTION_USER_PROMPT,
            },
          ],
        },
      ],
    });
    rawText = result.text;

    // ```json``` フェンス や 前置き / 末尾解説 を 落として 純粋 な JSON を 取り出す
    const jsonText = extractJsonFromText(rawText.trim());
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error("[client-extract] JSON.parse failed", {
        message: parseErr instanceof Error ? parseErr.message : String(parseErr),
        rawText: rawText.slice(0, 2000),
        jsonText: jsonText.slice(0, 2000),
      });
      return {
        ok: false,
        reason: "schema_error",
        message: "AI 出力が 有効な JSON では ありませんでした",
      };
    }

    const validated = clientExtractionSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("[client-extract] zod validation failed", {
        issues: validated.error.issues,
        rawText: rawText.slice(0, 2000),
      });
      return {
        ok: false,
        reason: "schema_error",
        message: `抽出結果の 検証に 失敗: ${validated.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"} - ${i.message}`)
          .join(" / ")}`,
      };
    }
    return { ok: true, result: validated.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[client-extract] generateText failed", {
      name: err instanceof Error ? err.name : "unknown",
      message,
      rawText: rawText.slice(0, 2000),
    });
    return { ok: false, reason: "ai_error", message };
  }
}

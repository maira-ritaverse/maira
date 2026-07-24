/**
 * 求人票 PDF / 画像 から 構造化求人情報を 抽出する 純粋ヘルパ。
 *
 * 副作用なし(認証 / クォータ / DB 書き込みは route.ts 側で 行う)。
 * テストや 内部スクリプトから 直接 呼べる ように 分離した。
 *
 * 採用モデル: claude-sonnet-4-6(Vision 対応)
 * 対応ファイル: application/pdf, image/png, image/jpeg, image/webp
 *
 * 実装方針:
 *   ・Anthropic tool use (generateObject) は schema が 18 カラムを 超えると
 *     「Schema is too complex」「too many parameters with union types」で
 *     拒否される。これを 回避 する ため generateText で JSON 出力 を 指示し、
 *     後段で zod 検証する アプローチ を 採用 (career-intake と 同じ パターン)。
 *
 * 100 % 信頼できる 抽出は 不可能なので、戻り値の `confidence`(high/medium/low)を
 * 添えて 返し、UI 側で「読み取り精度」を 表示できる ようにする。
 */
import { generateText, type ModelMessage } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";
import { extractJsonFromText } from "@/lib/career-intake/extract-json";
import {
  buildJobExtractionTextPrompt,
  JOB_EXTRACTION_SYSTEM_PROMPT,
  JOB_EXTRACTION_USER_PROMPT,
  jobExtractionSchema,
  type JobExtractionResult,
} from "@/lib/ai/prompts/job-extract-from-document";

/** ブラウザから 受け取った 添付ファイルの 最大サイズ(10 MB)。 */
export const JOB_EXTRACT_MAX_BYTES = 10 * 1024 * 1024;

export const JOB_EXTRACT_SUPPORTED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type JobExtractMime = (typeof JOB_EXTRACT_SUPPORTED_MIME)[number];

export function isSupportedJobExtractMime(mime: string): mime is JobExtractMime {
  return (JOB_EXTRACT_SUPPORTED_MIME as readonly string[]).includes(mime);
}

export type ExtractJobInput = {
  /** PDF / 画像の バイナリ。Vercel AI SDK は Uint8Array / Buffer / Blob を 受け付ける。 */
  data: Uint8Array;
  /** application/pdf, image/png 等。 */
  mimeType: JobExtractMime;
  /** AI 呼び出しに 紐づける セッション識別子(障害調査用、なくても OK)。 */
  traceId?: string;
};

export type ExtractJobOutput =
  | { ok: true; result: JobExtractionResult }
  | { ok: false; reason: "ai_error"; message: string }
  | { ok: false; reason: "schema_error"; message: string };

/**
 * generateText で JSON 出力 を 指示 → フェンス除去 → zod 検証、までの 共通コア。
 *
 * PDF / 画像 版(extractJobFromDocument)と URL / テキスト 版(extractJobFromText)で
 * 入力メッセージだけ 差し替えて 使う。後段(パース + 検証 + エラー整形)は 完全に 共通。
 * schema 制約は 後段の zod で 検証する ので、Anthropic 側 の tool use 制限
 * (union 16 個 / Schema is too complex)を 完全に 回避 できる。
 */
async function runJobExtraction(messages: ModelMessage[]): Promise<ExtractJobOutput> {
  let rawText = "";
  try {
    const result = await generateText({
      model: getModel(MODELS.CONVERSATION),
      system: JOB_EXTRACTION_SYSTEM_PROMPT,
      messages,
    });
    rawText = result.text;

    // ```json``` フェンス や 前置き / 末尾解説 を 落として 純粋な JSON を 取り出す
    const jsonText = extractJsonFromText(rawText.trim());
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error("[job-extract] JSON.parse failed", {
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

    const validated = jobExtractionSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("[job-extract] zod validation failed", {
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
    console.error("[job-extract] generateText failed", {
      name: err instanceof Error ? err.name : "unknown",
      message,
      rawText: rawText.slice(0, 2000),
    });
    return { ok: false, reason: "ai_error", message };
  }
}

/**
 * Claude Sonnet 4.6 に PDF / 画像を 添付して 構造化抽出 を 依頼する。
 *
 * AI SDK v6 の messages 形式で multimodal を 渡す。PDF / 画像 の 区別は
 * mimeType を 元に SDK 側が ハンドリングする。Anthropic は ネイティブで
 * application/pdf を 受け取れる ので、サーバー側で 画像化する 必要は ない。
 */
export async function extractJobFromDocument(input: ExtractJobInput): Promise<ExtractJobOutput> {
  return runJobExtraction([
    {
      role: "user",
      content: [
        { type: "file", data: input.data, mediaType: input.mimeType },
        { type: "text", text: JOB_EXTRACTION_USER_PROMPT },
      ],
    },
  ]);
}

export type ExtractJobFromTextInput = {
  /** 求人ページ から 取得・整形済みの 本文テキスト。 */
  text: string;
  /** AI 呼び出しに 紐づける セッション識別子(障害調査用、なくても OK)。 */
  traceId?: string;
};

/**
 * 求人ページ URL から 取得した 本文テキストを Claude に 渡して 構造化抽出する。
 *
 * PDF / 画像 版と 違い マルチモーダルでは なく テキストのみ。プロンプトで
 * 「Web ページの ノイズ(ナビ / 広告 / 関連求人)を 無視し メイン求人 1 件だけ 抽出」を
 * 明示している(buildJobExtractionTextPrompt)。
 */
export async function extractJobFromText(
  input: ExtractJobFromTextInput,
): Promise<ExtractJobOutput> {
  return runJobExtraction([{ role: "user", content: buildJobExtractionTextPrompt(input.text) }]);
}

/**
 * AI 出力を フォーム既定値 として 渡せる 形に 整える。
 *
 * AI 出力は すべて nullable だが、フォーム(createJobRequestSchema)は
 * `.optional().or(z.literal(""))` 形式で 「文字列 or 空文字」を 期待する。
 * UI で `<input defaultValue=...>` に そのまま 渡す ため、null → "" へ
 * 寄せる だけの 軽い 変換。数値項目(salary_min/max)は number または ""。
 */
export function jobExtractionToFormDefaults(r: JobExtractionResult): {
  company_name: string;
  position: string;
  employment_type: string;
  location: string;
  salary_min: number | "";
  salary_max: number | "";
  description: string;
  required_skills: string;
  preferred_skills: string;
  work_change_scope: string;
  location_change_scope: string;
  smoking_prevention_measure: string;
  probation_period: string;
  work_hours: string;
  break_time: string;
  holidays: string;
  application_qualifications: string;
} {
  const t = (v: string | null): string => (v == null ? "" : v.trim());
  const n = (v: number | null): number | "" => (v == null ? "" : v);
  return {
    // 必須 2 項目は AI が null を 返したら 「不明」を 入れて UI 側で 必須入力を 促す
    company_name: t(r.company_name),
    position: t(r.position),
    employment_type: t(r.employment_type),
    location: t(r.location),
    salary_min: n(r.salary_min),
    salary_max: n(r.salary_max),
    description: t(r.description),
    required_skills: t(r.required_skills),
    preferred_skills: t(r.preferred_skills),
    work_change_scope: t(r.work_change_scope),
    location_change_scope: t(r.location_change_scope),
    smoking_prevention_measure: t(r.smoking_prevention_measure),
    probation_period: t(r.probation_period),
    work_hours: t(r.work_hours),
    break_time: t(r.break_time),
    holidays: t(r.holidays),
    application_qualifications: t(r.application_qualifications),
  };
}

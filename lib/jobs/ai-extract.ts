/**
 * 求人票 PDF / 画像 から 構造化求人情報を 抽出する 純粋ヘルパ。
 *
 * 副作用なし(認証 / クォータ / DB 書き込みは route.ts 側で 行う)。
 * テストや 内部スクリプトから 直接 呼べる ように 分離した。
 *
 * 採用モデル: claude-sonnet-4-6(Vision 対応)
 * 対応ファイル: application/pdf, image/png, image/jpeg, image/webp
 *
 * 100 % 信頼できる 抽出は 不可能なので、戻り値の `confidence`(high/medium/low)を
 * 添えて 返し、UI 側で「読み取り精度」を 表示できる ようにする。
 */
import { generateObject } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";
import {
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
 * Claude Sonnet 4.6 に PDF / 画像を 添付して 構造化抽出 を 依頼する。
 *
 * AI SDK v6 の messages 形式で multimodal を 渡す。PDF / 画像 の 区別は
 * mimeType を 元に SDK 側が ハンドリングする。Anthropic は ネイティブで
 * application/pdf を 受け取れる ので、サーバー側で 画像化する 必要は ない。
 */
export async function extractJobFromDocument(input: ExtractJobInput): Promise<ExtractJobOutput> {
  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: jobExtractionSchema,
      system: JOB_EXTRACTION_SYSTEM_PROMPT,
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
              text: JOB_EXTRACTION_USER_PROMPT,
            },
          ],
        },
      ],
    });

    return { ok: true, result: result.object };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 本番運用で 原因 追跡できる ように、AI SDK が 投げる 例外の 構造を そのまま
    // サーバーログに 残す。Vercel の Functions ログ で 「どの フィールドが
    // schema に 引っかかったか」を 確認できる ようにする。
    // err.cause に zod の ZodError が 入る ケースが あるので そこ も 出す。
    const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
    console.error("[job-extract] generateObject failed", {
      name: err instanceof Error ? err.name : "unknown",
      message,
      cause: cause instanceof Error ? { name: cause.name, message: cause.message } : cause,
    });
    // zod での schema 不一致は 例外メッセージに "schema" などが 含まれる ので、
    // ヒューリスティックで 分類して UI 側の リトライ判断を しやすくする。
    if (
      /schema|validation|too[_ ]big|invalid|type[_ ]validation|NoObjectGenerated/i.test(message)
    ) {
      return { ok: false, reason: "schema_error", message };
    }
    return { ok: false, reason: "ai_error", message };
  }
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

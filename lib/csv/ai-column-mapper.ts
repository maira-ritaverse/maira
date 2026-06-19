/**
 * CSV カラム AI マッピング ヘルパ(純粋関数 + AI 呼出 ラッパ)
 *
 * 副作用なし(認証 / クォータ / DB 書き込みは route.ts 側で 行う)。
 * テストや 内部スクリプトから 直接 呼べる ように 分離した。
 */
import { generateObject } from "ai";

import { getModel, MODELS } from "@/lib/ai/client";
import {
  buildCsvMapPrompt,
  CSV_CANONICAL_COLUMNS,
  csvMappingResultSchema,
  type CsvMapTarget,
  type CsvMappingResult,
} from "@/lib/ai/prompts/csv-column-map";

export type MapColumnsInput = {
  target: CsvMapTarget;
  csvHeaders: string[];
  sampleRows: ReadonlyArray<Record<string, string>>;
};

export type MapColumnsOutput =
  | { ok: true; result: CsvMappingResult }
  | { ok: false; reason: "ai_error" | "schema_error"; message: string };

/**
 * 既存 HEADER_ALIASES だけで 解決できる ケースを 弾く ための ヘルパ。
 * AI 呼出 0 回で 全件 解決できた 場合は route.ts 側で「no_ai_needed」を 返せる。
 *
 * 引数の aliases は { canonical: [alias1, alias2, ...] } 形式。
 */
export function precomputeAliasMatches(
  csvHeaders: string[],
  aliases: Record<string, string[]>,
): CsvMappingResult["mappings"] {
  const aliasIndex = new Map<string, string>();
  for (const [canonical, list] of Object.entries(aliases)) {
    for (const a of list) {
      aliasIndex.set(a.toLowerCase().trim(), canonical);
    }
  }
  return csvHeaders.map((header) => {
    const matched = aliasIndex.get(header.toLowerCase().trim());
    return {
      csvHeader: header,
      canonical: matched ?? null,
      confidence: matched ? ("high" as const) : ("low" as const),
      reason: matched ? "ヘッダー名 完全一致" : null,
    };
  });
}

/**
 * AI 呼出 後の 結果を 「実在する canonical key」のみに 制限する 後処理。
 * AI が ハルシネーションで 標準カラムに 無い キーを 返した 場合は null に 寄せる。
 */
export function sanitizeAiMapping(
  target: CsvMapTarget,
  result: CsvMappingResult,
): CsvMappingResult {
  const validKeys = new Set(CSV_CANONICAL_COLUMNS[target].map((c) => c.key));
  return {
    mappings: result.mappings.map((m) => ({
      ...m,
      canonical: m.canonical && validKeys.has(m.canonical) ? m.canonical : null,
    })),
  };
}

export async function mapCsvColumns(input: MapColumnsInput): Promise<MapColumnsOutput> {
  const { system, prompt } = buildCsvMapPrompt(input);
  try {
    const result = await generateObject({
      model: getModel(MODELS.CONVERSATION),
      schema: csvMappingResultSchema,
      system,
      prompt,
    });
    return { ok: true, result: sanitizeAiMapping(input.target, result.object) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/schema|validation|parse/i.test(message)) {
      return { ok: false, reason: "schema_error", message };
    }
    return { ok: false, reason: "ai_error", message };
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { CSV_CANONICAL_COLUMNS } from "@/lib/ai/prompts/csv-column-map";
import { mapCsvColumns } from "@/lib/csv/ai-column-mapper";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";

/**
 * POST /api/agency/import/ai-map
 *
 * CSV 取り込み時の 「ヘッダー → 標準カラム」マッピング 提案。
 * clients / jobs 両方の リソースに 対応する 統合 endpoint(target で 切替)。
 *
 * フロー:
 *   1. 認証 + 組織メンバー チェック
 *   2. 組織横断 月次クォータ(kind="csv_column_mapping")
 *   3. リクエスト検証(target / headers / sampleRows)
 *   4. Claude Sonnet 4.6 で マッピング 推論(zod schema で 出力 形を 強制)
 *   5. ai_usage_events に 1 行 INSERT
 *   6. mappings 配列を 返す
 *
 * 設計判断:
 *   ・サンプル行の 制限を 3 行 / 各セル 30 字に 絞り、PII 漏洩リスク を 最小化。
 *     全行を 送ると 「未マッピング 標準カラム」が 増える ほど プロンプトが 膨らみ、
 *     失敗率も 上がる ため。
 *   ・既存 HEADER_ALIASES だけで 全部 マッチ する 場合でも AI を 呼ぶ:
 *     ユーザー視点で「同じ UI で 動くこと」が 重要(分岐させると UX が ブレる)。
 *     コストは 1 回 ¥1 未満 なので 許容。
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  target: z.enum(["clients", "jobs"]),
  // 1 ファイルあたりの ヘッダー数 上限。50 を 超える CSV は そもそも 取り込まない。
  headers: z.array(z.string().min(1).max(200)).min(1).max(50),
  // サンプル行は 最大 3 行に 制限(PII 漏洩抑制 + プロンプト肥大化 抑制)。
  sampleRows: z
    .array(z.record(z.string(), z.string().max(200)))
    .max(3)
    .default([]),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 組織横断 月次上限 チェック
  const usage = await checkAiUsageLimit(supabase, user.id, "csv_column_mapping");
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: "over_quota",
        message: `組織の月次 AI 利用上限に達しました(${usage.current} / ${usage.limit})。来月のリセット後、または 管理者が設定変更後に再試行してください。`,
        current: usage.current,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
      },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const { target, headers, sampleRows } = parsed.data;

  const ai = await mapCsvColumns({ target, csvHeaders: headers, sampleRows });
  if (!ai.ok) {
    return NextResponse.json(
      {
        error: ai.reason,
        message:
          ai.reason === "schema_error"
            ? "AI 出力の 構造が 不正でした。再度 お試しください。"
            : "AI 呼び出しに 失敗しました。時間を 置いて 再度 お試しください。",
        detail: ai.message,
      },
      { status: 502 },
    );
  }

  await recordAiUsage(supabase, user.id, "csv_column_mapping", {
    target,
    headers_count: headers.length,
    sample_rows_count: sampleRows.length,
  });

  return NextResponse.json({
    mappings: ai.result.mappings,
    canonicalColumns: CSV_CANONICAL_COLUMNS[target],
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireOrgMember } from "@/lib/api/auth-guards";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import { extractJobFromText, jobExtractionToFormDefaults } from "@/lib/jobs/ai-extract";
import { fetchJobPageText } from "@/lib/jobs/fetch-job-url";

/**
 * POST /api/agency/jobs/parse-url
 *
 * 求人媒体 / 企業採用ページ の URL から AI で 構造化求人情報を 抽出する。
 * parse-document(PDF / 画像)の URL 版。DB には 保存しない 2 段階フロー
 * (取得した defaults を フォームに 当ててから 通常の POST /api/agency/jobs)。
 *
 * フロー:
 *   1. 認証 + 組織メンバー確認(seeker は 403 で 弾く)
 *   2. AI クォータ(kind="job_extract_from_document" を 再利用)を チェック
 *      ・URL 版も PDF 版も 同じ Claude 抽出で コスト同一の ため 同じ枠で 集計する
 *   3. URL を SSRF 対策付きで 取得 → 本文テキストに 整形
 *   4. Claude Sonnet 4.6 で 構造化抽出
 *   5. ai_usage_events に 1 行 INSERT(source="url"、失敗しても 本処理は 止めない)
 *   6. フォーム既定値 形式に 整形して 返す
 *
 * セキュリティ:
 *   ・fetchJobPageText 側で スキーム allowlist / 内部 IP 拒否 / リダイレクト
 *     再検証 / タイムアウト / サイズ上限 を 実施(SSRF 対策)
 *   ・取得した 本文 / URL は API レスポンス と 一時ログ 以外に 永続化しない
 */

export const runtime = "nodejs";
// Claude Sonnet 4.6 で 長文の 求人ページ を 構造化する 場合、30-120 秒 かかる ことが
// あり、デフォルト 60 秒 だと Vercel が 関数を 殺して HTML エラーページ を 返す。
export const maxDuration = 300;

const bodySchema = z.object({
  url: z.string().trim().min(1, "URL を入力してください").max(2048),
});

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 組織横断 月次上限チェック(PDF 抽出と 同じ枠で 集計)
  const usage = await checkAiUsageLimit(supabase, user.id, "job_extract_from_document");
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
  const parsed = bodySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        message: parsed.error.issues[0]?.message ?? "URL が正しくありません。",
      },
      { status: 400 },
    );
  }

  // URL 取得 + 本文テキスト化(SSRF 対策込み)
  const page = await fetchJobPageText(parsed.data.url);
  if (!page.ok) {
    // ユーザー入力起因(不正URL / 内部IP / 非HTML / 空)は 400、
    // 取得先の 障害(HTTP エラー / タイムアウト)は 502 相当。
    const clientError =
      page.reason === "invalid_url" ||
      page.reason === "blocked_host" ||
      page.reason === "unsupported_content" ||
      page.reason === "empty_content" ||
      page.reason === "too_large";
    return NextResponse.json(
      { error: page.reason, message: page.message },
      { status: clientError ? 400 : 502 },
    );
  }

  const ai = await extractJobFromText({ text: page.text });
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

  // 利用ログ(失敗しても 本処理は 止めない)。URL は 機密ではない ので ホストのみ 残す。
  let urlHost = "";
  try {
    urlHost = new URL(page.finalUrl).host;
  } catch {
    urlHost = "";
  }
  await recordAiUsage(supabase, user.id, "job_extract_from_document", {
    source: "url",
    url_host: urlHost,
    confidence: ai.result.confidence,
  });

  return NextResponse.json({
    defaults: jobExtractionToFormDefaults(ai.result),
    confidence: ai.result.confidence,
    extractionNotes: ai.result.extraction_notes,
    sourceUrl: page.finalUrl,
  });
}

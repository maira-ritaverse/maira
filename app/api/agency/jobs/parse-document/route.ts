import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { checkAiUsageLimit, recordAiUsage } from "@/lib/features/ai-usage";
import {
  extractJobFromDocument,
  isSupportedJobExtractMime,
  jobExtractionToFormDefaults,
  JOB_EXTRACT_MAX_BYTES,
  JOB_EXTRACT_SUPPORTED_MIME,
} from "@/lib/jobs/ai-extract";

/**
 * POST /api/agency/jobs/parse-document
 *
 * 求人票 PDF / 画像 から AI で 構造化求人情報を 抽出する。
 * 結果は DB には 保存しない:呼び出し元(新規求人フォーム)が 取得した defaults を
 * フォームに 当てた 上で「保存」を 押した タイミングで 通常の POST /api/agency/jobs に
 * 投げ直す 2 段階 フロー。AI が ミスして いて も DB を 汚さない 設計。
 *
 * フロー:
 *   1. 認証 + 組織メンバー確認(seeker は 触れない、403 で 弾く)
 *   2. 組織横断 月次クォータ(kind="job_extract_from_document")を チェック
 *   3. multipart/form-data の "file" を 受け取り、サイズ / mime 種別を 検証
 *   4. Claude Sonnet 4.6(Vision)で 構造化抽出
 *   5. ai_usage_events に 1 行 INSERT(失敗しても 本処理は 止めない)
 *   6. フォーム既定値 形式に 整形して 返す
 *
 * セキュリティ:
 *   ・PDF / 画像は サーバーで 一旦 メモリに 保持するが、永続化しない
 *   ・受け取った バイナリは Anthropic API に そのまま 送る(プライバシーポリシー
 *     第 5 条「AI 学習 opt-out 契約」の 範囲)
 *   ・抽出結果は API レスポンスのみ:DB / Storage / ログ には 残さない
 *     (機密性の 高い 求人票が 平文で 残らない ように)
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 組織横断 月次上限チェック(admin が /agency/settings/ai-usage で 設定)
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

  // multipart の file を 取り出す
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "file_required", message: "PDF または 画像 を 1 件 添付してください。" },
      { status: 400 },
    );
  }
  if (!isSupportedJobExtractMime(file.type)) {
    return NextResponse.json(
      {
        error: "unsupported_mime",
        message: `対応形式は ${JOB_EXTRACT_SUPPORTED_MIME.join(" / ")} です。`,
      },
      { status: 400 },
    );
  }
  if (file.size > JOB_EXTRACT_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `ファイルサイズは ${JOB_EXTRACT_MAX_BYTES / 1024 / 1024}MB 以下にしてください。`,
      },
      { status: 400 },
    );
  }

  // Blob → Uint8Array(Anthropic SDK は Uint8Array を 受け付ける)
  const buf = new Uint8Array(await file.arrayBuffer());

  const ai = await extractJobFromDocument({
    data: buf,
    mimeType: file.type,
  });
  if (!ai.ok) {
    // 上流の AI 失敗は 502(Bad Gateway 相当)。schema_error は AI が
    // フォーマット崩した ケースなので リトライ案内を 添える。
    const status = ai.reason === "schema_error" ? 502 : 502;
    return NextResponse.json(
      {
        error: ai.reason,
        message:
          ai.reason === "schema_error"
            ? "AI 出力の 構造が 不正でした。再度 お試しください。"
            : "AI 呼び出しに 失敗しました。時間を 置いて 再度 お試しください。",
        detail: ai.message,
      },
      { status },
    );
  }

  // 利用ログ(失敗しても 本処理は 止めない)
  await recordAiUsage(supabase, user.id, "job_extract_from_document", {
    mime_type: file.type,
    bytes: file.size,
    confidence: ai.result.confidence,
  });

  // フォーム既定値 + 抽出メタ を 返す
  return NextResponse.json({
    defaults: jobExtractionToFormDefaults(ai.result),
    confidence: ai.result.confidence,
    extractionNotes: ai.result.extraction_notes,
  });
}

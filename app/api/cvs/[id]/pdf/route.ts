import { createClient } from "@/lib/supabase/server";
import { buildCvHtml } from "@/lib/cvs/cv-html";
import { getCvWithLinkedResume } from "@/lib/cvs/queries";
import { generatePdfFromHtml, PdfTimeoutError } from "@/lib/pdf/generate";

/**
 * GET /api/cvs/[id]/pdf
 *
 * 職務経歴書を PDF として返す。
 *
 * - Puppeteer を使うため Node ランタイム必須(Edge では動かない)
 * - PDF 生成は秒単位で時間がかかるため maxDuration を伸ばす(Vercel)
 * - 履歴書 /api/resumes/[id]/pdf と同型の作り:
 *   - 所有者チェックは getCvWithLinkedResume 経由(本人かつ存在するもののみ)
 *   - 履歴書参照解決(name / licenses)は helper に集約
 *   - ファイル名は title 由来、英数記号以外は _ に置換、RFC 5987 で UTF-8 名も渡す
 *
 * ※ ローカル開発では puppeteer のローカル Chromium を使う。
 *    本番(Vercel)対応は CHROMIUM_REMOTE_EXEC_PATH の設定が必要(履歴書と同じ課題)。
 */

export const runtime = "nodejs";
export const maxDuration = 60;
// PDF はリクエストごとに動的生成(キャッシュ無効)
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // getCvWithLinkedResume は本人かつ存在するもののみ返す。
  // 履歴書参照(license_resume_id)の解決もここで一度に済ませる。
  const resolved = await getCvWithLinkedResume(id, user.id);
  if (!resolved) {
    return new Response("Not Found", { status: 404 });
  }

  const { cv, linkedResumeName, linkedResumeLicenses } = resolved;

  try {
    const html = buildCvHtml({
      body: cv.body,
      name: linkedResumeName,
      licenses: linkedResumeLicenses,
      documentDate: cv.documentDate,
      title: cv.title,
    });

    const pdf = await generatePdfFromHtml(html);

    // ファイル名は title + 拡張子。英数とハイフン以外は _ に置換(履歴書と同方式)。
    const safeTitle = cv.title.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 60);
    const filename = `${safeTitle || "職務経歴書"}.pdf`;
    // RFC 5987 形式で UTF-8 ファイル名も渡す(日本語タイトルでも文字化けしないように)。
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cv.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // タイムアウトはユーザー側の再試行で直る可能性があるので 504 + 説明文を返す。
    // クライアント(cv-tabs)で fetch 結果のテキストをそのままアラート表示するため、
    // text/plain で日本語のメッセージをそのまま渡す。
    if (error instanceof PdfTimeoutError) {
      console.error("[cv pdf] timeout:", error.message);
      return new Response(error.message, {
        status: 504,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // それ以外の失敗(Chromium 起動失敗 / フォント取得失敗 / 想定外例外等)は
    // 詳細はサーバーログにのみ残し、クライアントには簡潔なメッセージを返す。
    console.error("[cv pdf] failed to generate:", error);
    return new Response("PDF の生成に失敗しました。しばらく経って再度お試しください。", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

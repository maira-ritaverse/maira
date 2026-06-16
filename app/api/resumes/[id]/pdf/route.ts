import { createClient } from "@/lib/supabase/server";
import { getResume } from "@/lib/resumes/queries";
import {
  applyResumeOverrides,
  getApplicationPrCustomization,
} from "@/lib/applications/pr-customizations";
import {
  createResumePhotoSignedUrl,
  PHOTO_SIGNED_URL_PDF_EXPIRES_SEC,
} from "@/lib/resumes/photo-signed-url";
import { buildResumeHtml } from "@/lib/resumes/resume-html";
import { generatePdfFromHtml } from "@/lib/pdf/generate";

/**
 * GET /api/resumes/[id]/pdf
 *
 * 履歴書を PDF として返す。
 *
 * - Puppeteer を使うため Node ランタイム必須(Edge では動かない)
 * - PDF 生成は秒単位で時間がかかるため maxDuration を伸ばす(Vercel)
 * - RLS は getResume 側で user.id と一致するレコードのみ取得するため、
 *   存在しなければ 404 を返す(他人の id が漏れても情報を返さない)
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

  // getResume は本人かつ存在するもののみ返すので、これ 1 本で所有者チェックも兼ねる。
  const resume = await getResume(id, user.id);
  if (!resume) {
    return new Response("Not Found", { status: 404 });
  }

  // ?applicationId=xxx があれば、その応募の PR カスタマイズ(motivation_note / self_pr)を
  // 履歴書の motivationNote 欄に反映した状態で PDF を生成する。
  // 応募の所有者が本人でない / カスタマイズが存在しない場合は黙ってベースの履歴書を出す。
  const url = new URL(_request.url);
  const applicationId = url.searchParams.get("applicationId");
  let effectiveResume = resume;
  if (applicationId) {
    const { data: appRow } = await supabase
      .from("applications")
      .select("user_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (appRow && (appRow as { user_id: string }).user_id === user.id) {
      const custom = await getApplicationPrCustomization(applicationId);
      if (custom) {
        effectiveResume = applyResumeOverrides(resume, custom.overrides);
      }
    }
  }

  try {
    // 写真は private バケットなので、PDF 生成直前に短命の署名URLを発行して
    // HTML に埋め込む。Puppeteer は networkidle0 まで待つため生成中に取得され、
    // 直後には URL が失効する(漏れても再利用されにくい)。
    const photoSignedUrl = effectiveResume.photoUrl
      ? await createResumePhotoSignedUrl(effectiveResume.photoUrl, PHOTO_SIGNED_URL_PDF_EXPIRES_SEC)
      : null;

    const html = buildResumeHtml(effectiveResume, { photoSignedUrl });
    const pdf = await generatePdfFromHtml(html);

    // ファイル名は title + 拡張子。安全のため英数とハイフン以外は除去する。
    const safeTitle = effectiveResume.title.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 60);
    const filename = `${safeTitle || "resume"}.pdf`;
    // RFC 5987 形式で UTF-8 ファイル名を渡し、日本語タイトルでも文字化けしないようにする。
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // PDF 生成中の失敗(Chromium 起動失敗 / フォント取得失敗等)はサーバーログに残し、
    // クライアントには簡潔なメッセージを返す。
    console.error("[resume pdf] failed to generate:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

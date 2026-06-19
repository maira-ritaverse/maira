import { requireOrgMember } from "@/lib/api/auth-guards";
import { getClientRecord } from "@/lib/clients/queries";
import { generatePdfFromHtml, PdfTimeoutError } from "@/lib/pdf/generate";
import {
  createResumePhotoSignedUrl,
  PHOTO_SIGNED_URL_PDF_EXPIRES_SEC,
} from "@/lib/resumes/photo-signed-url";
import { getResume } from "@/lib/resumes/queries";
import { buildResumeHtml } from "@/lib/resumes/resume-html";

/**
 * GET /api/agency/clients/[id]/resumes/[resumeId]/pdf
 *
 * 求職者が 共有 した 履歴書を エージェント が PDF として ダウンロード する。
 *
 * 認可(閲覧ページ /agency/clients/[id]/resumes/[resumeId] と 同じ ガード):
 *   1. organization_member であること(requireOrgMember)
 *   2. URL の clientRecordId が 自組織 かつ link_status='linked' で あること
 *   3. resume.user_id が client_records.linked_user_id と 一致 すること
 *
 *   DB 側でも Phase 4 RLS で 1〜3 が ガード されている が、本ルートでも
 *   明示確認(防御的)。
 *
 * 写真:
 *   ・本人側 と 同じく 短命の 署名 URL を 発行 して HTML に 埋め込む
 *   ・Storage RLS で agency 経由 では 発行 できない 場合は 写真欄 を 省略
 *
 * セキュリティ:
 *   ・本ルートは agency member 限定。求職者 セッション からは 触れない
 *   ・ファイル名は title から 安全に 変換(エンコード処理あり)
 */
export const runtime = "nodejs";
// PDF 生成 (Puppeteer + Chromium 起動 + フォント取得) は 数秒〜十数秒 かかる ため
// 余裕を 持って 60 秒 取る。求人票 (Vision PDF) と 違って 軽量タスク。
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string; resumeId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: clientRecordId, resumeId } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const client = await getClientRecord(clientRecordId);
  if (
    !client ||
    client.organizationId !== organization.id ||
    client.linkStatus !== "linked" ||
    !client.linkedUserId
  ) {
    return new Response("Not Found", { status: 404 });
  }

  const resume = await getResume(resumeId, client.linkedUserId);
  if (!resume) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    // 写真の 署名URL は 失敗しても 全体は 壊さない(プレースホルダ 経路へ フォールバック)
    let photoSignedUrl: string | null = null;
    if (resume.photoUrl) {
      try {
        photoSignedUrl = await createResumePhotoSignedUrl(
          resume.photoUrl,
          PHOTO_SIGNED_URL_PDF_EXPIRES_SEC,
        );
      } catch {
        photoSignedUrl = null;
      }
    }

    const html = buildResumeHtml(resume, { photoSignedUrl });
    const pdf = await generatePdfFromHtml(html);

    const safeTitle = `${client.name}_${resume.title}`
      .replace(/[^\p{L}\p{N}\-_]/gu, "_")
      .slice(0, 80);
    const filename = `${safeTitle || "resume"}.pdf`;
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PdfTimeoutError) {
      return new Response(err.message, { status: 504 });
    }
    console.error("[agency client-resume pdf] failed:", err);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

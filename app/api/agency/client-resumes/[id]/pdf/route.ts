import { requireOrgMember } from "@/lib/api/auth-guards";
import { agencyClientResumeToSeekerResume } from "@/lib/agency-client-documents/agency-resume-mapper";
import {
  AGENCY_PHOTO_SIGNED_URL_PDF_EXPIRES_SEC,
  createAgencyClientPhotoSignedUrl,
} from "@/lib/agency-client-documents/photo-signed-url";
import { getAgencyClientResume } from "@/lib/agency-client-documents/queries";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { buildResumeHtml } from "@/lib/resumes/resume-html";

/**
 * GET /api/agency/client-resumes/[id]/pdf
 *
 * エージェント所有の履歴書を PDF として返す。
 *
 * 設計判断:
 *   ・seeker 側 /api/resumes/[id]/pdf と同じレイアウト(厚労省様式)を
 *     使うため、AgencyClientResume → Resume にマッピングして既存
 *     buildResumeHtml + generatePdfFromHtml を再利用する。
 *   ・写真は agency-client-photos バケットの短命署名 URL を発行して
 *     HTML に埋め込む(5 分有効)。Puppeteer が取得した直後に切れる。
 *
 * 認可:
 *   ・requireOrgMember(archived ガード込み)
 *   ・履歴書の organization_id 一致確認
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  const resume = await getAgencyClientResume(id, organization.id);
  if (!resume) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const seekerResume = agencyClientResumeToSeekerResume(resume);
    const photoSignedUrl = resume.photoStoragePath
      ? await createAgencyClientPhotoSignedUrl(
          resume.photoStoragePath,
          AGENCY_PHOTO_SIGNED_URL_PDF_EXPIRES_SEC,
        )
      : null;

    const html = buildResumeHtml(seekerResume, { photoSignedUrl });
    const pdf = await generatePdfFromHtml(html);

    const safeTitle = resume.title.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 60);
    const filename = `${safeTitle || "resume"}.pdf`;
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[agency client-resumes pdf] failed:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

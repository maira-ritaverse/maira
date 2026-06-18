import { requireOrgMember } from "@/lib/api/auth-guards";
import { buildAgencyCvHtml } from "@/lib/agency-client-documents/agency-cv-html";
import { getAgencyClientCv } from "@/lib/agency-client-documents/queries";
import { getClientRecord } from "@/lib/clients/queries";
import { generatePdfFromHtml } from "@/lib/pdf/generate";

/**
 * GET /api/agency/client-cvs/[id]/pdf
 *
 * エージェント所有 職務経歴書を A4 縦 PDF として返す。
 *
 * 認可:
 *   ・requireOrgMember(archived ガード込み)
 *   ・職務経歴書の organization_id 一致確認
 *   ・client_record の所属組織 確認
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

  const cv = await getAgencyClientCv(id, organization.id);
  if (!cv) return new Response("Not Found", { status: 404 });

  const client = await getClientRecord(cv.clientRecordId);
  if (!client || client.organizationId !== organization.id) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const html = buildAgencyCvHtml({ cv, clientName: client.name });
    const pdf = await generatePdfFromHtml(html);
    const safeTitle = cv.title.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 60);
    const filename = `${safeTitle || "cv"}.pdf`;
    const encodedFilename = encodeURIComponent(filename);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cv.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[agency client-cvs pdf] failed:", err);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

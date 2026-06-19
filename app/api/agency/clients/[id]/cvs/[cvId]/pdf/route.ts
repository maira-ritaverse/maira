import { requireOrgMember } from "@/lib/api/auth-guards";
import { getClientRecord } from "@/lib/clients/queries";
import { buildCvHtml } from "@/lib/cvs/cv-html";
import { getCvWithLinkedResume } from "@/lib/cvs/queries";
import { generatePdfFromHtml, PdfTimeoutError } from "@/lib/pdf/generate";

/**
 * GET /api/agency/clients/[id]/cvs/[cvId]/pdf
 *
 * 求職者が 共有 した 職務経歴書を エージェント が PDF として ダウンロード する。
 * 履歴書 (resumes/[resumeId]/pdf) と 同じ パターン。
 *
 * 認可:
 *   1. organization_member であること
 *   2. URL の clientRecordId が 自組織 かつ link_status='linked'
 *   3. cv.user_id が client_records.linked_user_id と 一致
 *
 * 内部:
 *   ・seeker 側 /api/cvs/[id]/pdf と 同じ buildCvHtml + generatePdfFromHtml
 *   ・linkedUserId を 渡すこと で getCvWithLinkedResume の RLS を 通す
 *     (Phase 4 RLS で linked agency member は 求職者 リソース を 読める)
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string; cvId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id: clientRecordId, cvId } = await params;

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

  const resolved = await getCvWithLinkedResume(cvId, client.linkedUserId);
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

    const safeTitle = `${client.name}_${cv.title}`.replace(/[^\p{L}\p{N}\-_]/gu, "_").slice(0, 80);
    const filename = `${safeTitle || "職務経歴書"}.pdf`;
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cv.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PdfTimeoutError) {
      console.error("[agency client-cv pdf] timeout:", err.message);
      return new Response(err.message, {
        status: 504,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    console.error("[agency client-cv pdf] failed:", err);
    return new Response("PDF の生成に失敗しました。しばらく経って再度お試しください。", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

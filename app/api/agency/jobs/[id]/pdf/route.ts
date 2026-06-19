import { requireOrgMember } from "@/lib/api/auth-guards";
import { buildJobPostingHtml } from "@/lib/jobs/job-posting-html";
import { getJobPosting } from "@/lib/jobs/queries";
import { generatePdfFromHtml, PdfTimeoutError } from "@/lib/pdf/generate";

/**
 * GET /api/agency/jobs/[id]/pdf
 *
 * エージェント所有の 求人を 求人票テンプレ (サンプル準拠) で PDF 出力する。
 *
 * 認可:
 *   ・requireOrgMember
 *   ・求人の organization_id 一致 確認(他社の id を 踏んだら 404)
 *
 * セキュリティ:
 *   ・本ルートは organization member のみ。求職者には PDF を 開放しない
 *     (PDF は エージェントの 媒体 突合せ / 紙運用 用途)
 *   ・HTML 構築は escapeHtml で 注入対策
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

  const job = await getJobPosting(id);
  if (!job || job.organizationId !== organization.id) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const html = buildJobPostingHtml({ job, agencyName: organization.name });
    const pdf = await generatePdfFromHtml(html);
    const baseName = `${job.companyName}_${job.position}_求人票`
      .replace(/[^\p{L}\p{N}\-_]/gu, "_")
      .slice(0, 80);
    const filename = `${baseName || "job"}.pdf`;
    const encodedFilename = encodeURIComponent(filename);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="job.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PdfTimeoutError) {
      return new Response(err.message, { status: 504 });
    }
    console.error("[agency jobs pdf] failed:", err);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

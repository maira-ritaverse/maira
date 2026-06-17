import { requireOrgMember } from "@/lib/api/auth-guards";
import { getClientRecord } from "@/lib/clients/queries";
import { getJobPosting } from "@/lib/jobs/queries";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { getLetter, getTemplate } from "@/lib/recommendation-letters/queries";
import {
  buildRecommendationLetterFilename,
  buildRecommendationLetterHtml,
} from "@/lib/recommendation-letters/render-html";
import { getReferral } from "@/lib/referrals/queries";

/**
 * GET /api/agency/recommendation-letters/[id]/pdf
 *
 * 推薦文を PDF として返す。
 *
 * - Puppeteer を使うため Node ランタイム必須
 * - PDF 生成は秒単位で時間がかかるため maxDuration を伸ばす(Vercel)
 * - 推薦文 / referral / job_posting / client は組織スコープで取得し、
 *   別組織のものは getter が null を返すので 404 で弾く
 * - 発行日は呼び出し時の UTC 日付(YYYY-MM-DD)を使用
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

function todayIsoDate(): string {
  // UTC 日付を YYYY-MM-DD で(タイムゾーンを跨ぐ運用でも安定するように)
  return new Date().toISOString().slice(0, 10);
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { organization } = guard;

  // 推薦文を復号して取得
  const letter = await getLetter(id, organization.id);
  if (!letter) return new Response("Not Found", { status: 404 });

  // referral → job_posting / client_record を取得
  const referral = await getReferral(letter.referralId);
  if (!referral || referral.organizationId !== organization.id) {
    return new Response("Not Found", { status: 404 });
  }

  const [client, job, template] = await Promise.all([
    getClientRecord(referral.clientRecordId),
    getJobPosting(referral.jobPostingId),
    letter.templateId ? getTemplate(letter.templateId, organization.id) : Promise.resolve(null),
  ]);

  if (!client || !job) return new Response("Not Found", { status: 404 });

  try {
    const html = buildRecommendationLetterHtml({
      letter,
      template,
      organizationName: organization.name,
      recipientCompanyName: job.companyName,
      recipientPosition: job.position,
      documentDate: todayIsoDate(),
    });

    const pdf = await generatePdfFromHtml(html);

    const filename = buildRecommendationLetterFilename({
      candidateName: client.name,
      companyName: job.companyName,
      version: letter.version,
    });
    // RFC 5987 で UTF-8 のファイル名を渡し、日本語でも文字化けしないようにする
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="recommendation_letter.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[recommendation-letter pdf] failed to generate:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

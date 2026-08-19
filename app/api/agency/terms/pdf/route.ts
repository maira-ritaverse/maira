import { requireOrgMember } from "@/lib/api/auth-guards";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { buildTermsHtml } from "@/lib/terms/terms-html";

/**
 * GET /api/agency/terms/pdf
 *
 * 自組織の利用規約を PDF で返す(管理画面から確認・保存できるように)。
 *   - 同意済みなら「同意の記録」入り(署名者・日時・IP)。
 *   - 未同意なら未署名の状態で本文を表示(通常はゲートで同意済みのはず)。
 *
 * 認可:organization_member(archived / AAL2 ガード込み)。閲覧は全メンバー可。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { supabase, organization } = guard;

  const { data } = await supabase
    .from("organizations")
    .select("terms_accepted_at, terms_signer_name, terms_signer_ip")
    .eq("id", organization.id)
    .maybeSingle();
  const row = data as {
    terms_accepted_at: string | null;
    terms_signer_name: string | null;
    terms_signer_ip: string | null;
  } | null;

  try {
    const html = buildTermsHtml({
      organizationName: organization.name,
      signerName: row?.terms_signer_name ?? null,
      acceptedAt: row?.terms_accepted_at ?? null,
      ipAddress: row?.terms_signer_ip ?? null,
    });
    const pdf = await generatePdfFromHtml(html);
    const filename = "Myaira_Terms.pdf";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[agency terms pdf] failed:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

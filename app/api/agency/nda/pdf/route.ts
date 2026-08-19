import { requireOrgMember } from "@/lib/api/auth-guards";
import { CURRENT_NDA_VERSION } from "@/lib/nda/nda-content";
import { buildNdaHtml } from "@/lib/nda/nda-html";
import { generatePdfFromHtml } from "@/lib/pdf/generate";

/**
 * GET /api/agency/nda/pdf
 *
 * 自組織の NDA(秘密保持契約)を PDF で返す(管理画面から確認・保存できるように)。
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
    .select("nda_accepted_at, nda_version, nda_signer_name, nda_signer_ip")
    .eq("id", organization.id)
    .maybeSingle();
  const row = data as {
    nda_accepted_at: string | null;
    nda_version: string | null;
    nda_signer_name: string | null;
    nda_signer_ip: string | null;
  } | null;

  try {
    const html = buildNdaHtml({
      organizationName: organization.name,
      signerName: row?.nda_signer_name ?? null,
      acceptedAt: row?.nda_accepted_at ?? null,
      version: row?.nda_version ?? CURRENT_NDA_VERSION,
      ipAddress: row?.nda_signer_ip ?? null,
    });
    const pdf = await generatePdfFromHtml(html);
    const filename = "Myaira_NDA.pdf";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[agency nda pdf] failed:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

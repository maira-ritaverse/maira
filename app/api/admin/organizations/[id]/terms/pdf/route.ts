import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { consumeRateLimit } from "@/lib/rate-limit/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildTermsHtml } from "@/lib/terms/terms-html";

/**
 * GET /api/admin/organizations/[id]/terms/pdf
 *
 * 運営者(Myaira admin)が、対象組織の署名済み利用規約を PDF でダウンロードする。
 * 署名記録(署名者・日時・IP・利用組織の所在地)入り。
 *
 * Auth: profiles.is_maira_admin = true のみ。対象組織は service_role で読む。
 * 監査: 運営者による他組織の機密書類アクセスは admin_accessed_user で記録する。
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  if (!(await isMairaAdmin())) return new Response("forbidden", { status: 403 });

  // PDF 生成は Puppeteer を起動するため、連打 / 濫用でのコストを抑える。
  const rl = await consumeRateLimit({
    namespace: "admin:doc-download",
    identifier: user.id,
    windowSeconds: 60,
    maxCount: 30,
  });
  if (rl.limited) return new Response("rate limited", { status: 429 });

  const admin = createServiceClient();
  const { data } = await admin
    .from("organizations")
    .select("name, terms_accepted_at, terms_signer_name, terms_signer_ip, signing_org_address")
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    name: string | null;
    terms_accepted_at: string | null;
    terms_signer_name: string | null;
    terms_signer_ip: string | null;
    signing_org_address: string | null;
  } | null;
  if (!row) return new Response("not found", { status: 404 });

  // 誰がどの組織の署名済み書類をいつ取得したかを残す(証跡)。
  await recordAuditLog({
    userId: user.id,
    action: "admin_accessed_user",
    metadata: { event_subtype: "admin_downloaded_org_terms_pdf", organization_id: id },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  try {
    const html = buildTermsHtml({
      organizationName: row.name ?? "(エージェント企業)",
      signerName: row.terms_signer_name ?? null,
      acceptedAt: row.terms_accepted_at ?? null,
      ipAddress: row.terms_signer_ip ?? null,
      orgAddress: row.signing_org_address ?? null,
    });
    const pdf = await generatePdfFromHtml(html);
    const downloadName = `${row.name ?? "organization"}_Terms.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Myaira_Terms.pdf"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[admin terms pdf] failed:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

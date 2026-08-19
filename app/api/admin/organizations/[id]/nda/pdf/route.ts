import { isMairaAdmin } from "@/lib/announcements/platform-queries";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { CURRENT_NDA_VERSION } from "@/lib/nda/nda-content";
import { buildNdaHtml } from "@/lib/nda/nda-html";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { consumeRateLimit } from "@/lib/rate-limit/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/organizations/[id]/nda/pdf
 *
 * 運営者(Myaira admin)が、対象組織の署名済み NDA(秘密保持契約)を PDF で
 * ダウンロードする。署名記録(署名者・日時・IP・利用組織の所在地)入り。
 *
 * Auth: profiles.is_maira_admin = true のみ。対象組織は service_role で読む
 *       (運営者は全組織の署名控えを取得できる。RLS を跨ぐため service client)。
 * 監査: 運営者による他組織の機密書類アクセスは admin_accessed_user で記録する
 *       (reveal-notes と同じ方針)。
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
    .select(
      "name, nda_accepted_at, nda_version, nda_signer_name, nda_signer_ip, signing_org_address",
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    name: string | null;
    nda_accepted_at: string | null;
    nda_version: string | null;
    nda_signer_name: string | null;
    nda_signer_ip: string | null;
    signing_org_address: string | null;
  } | null;
  if (!row) return new Response("not found", { status: 404 });

  // 誰がどの組織の署名済み書類をいつ取得したかを残す(証跡)。
  await recordAuditLog({
    userId: user.id,
    action: "admin_accessed_user",
    metadata: { event_subtype: "admin_downloaded_org_nda_pdf", organization_id: id },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  try {
    const html = buildNdaHtml({
      organizationName: row.name ?? "(エージェント企業)",
      signerName: row.nda_signer_name ?? null,
      acceptedAt: row.nda_accepted_at ?? null,
      version: row.nda_version ?? CURRENT_NDA_VERSION,
      ipAddress: row.nda_signer_ip ?? null,
      orgAddress: row.signing_org_address ?? null,
    });
    const pdf = await generatePdfFromHtml(html);
    // 運営者は複数組織をダウンロードするため、ファイル名(UTF-8)に組織名を含める。
    const downloadName = `${row.name ?? "organization"}_NDA.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Myaira_NDA.pdf"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[admin nda pdf] failed:", error);
    return new Response("Failed to generate PDF", { status: 500 });
  }
}

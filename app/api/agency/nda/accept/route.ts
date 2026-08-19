import { after, NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { recordAuditLog } from "@/lib/audit/audit-log";
import { sendSignedNdaEmail } from "@/lib/email/nda-signed";
import { CURRENT_NDA_VERSION } from "@/lib/nda/nda-content";
import { buildNdaHtml } from "@/lib/nda/nda-html";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/agency/nda/accept
 *
 * エージェント組織の NDA(秘密保持契約)に、組織の管理者が代表して同意した記録を残す。
 *
 * - 認可:organization_member かつ role=admin のみ(代表署名は管理者に限定)。
 * - organizations.nda_* を service_role で更新(管理者本人であることを検証済み)。
 * - audit_logs に nda_accepted を記録(証跡)。
 * - 署名済み NDA を PDF 化して署名者の登録メールに送付(応答後に after で実行)。
 */
const bodySchema = z.object({
  signerName: z.string().trim().min(1, "氏名を入力してください").max(100),
  agreed: z.literal(true),
});

/** x-forwarded-for("ip1, ip2, ...")から先頭の IP を取り出す。 */
function firstIp(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { user, organization, member } = guard;

  // 組織を代表しての NDA 同意は管理者のみ。
  if (member.role !== "admin") {
    return NextResponse.json(
      { error: "admin_only", message: "NDA への同意は組織の管理者のみ可能です。" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const signerName = parsed.data.signerName;
  const nowIso = new Date().toISOString();
  const ip = firstIp(request.headers.get("x-forwarded-for"));

  // 記録は service_role で organizations を更新(管理者本人であることは上で検証済み)。
  const admin = createServiceClient();
  const { error } = await admin
    .from("organizations")
    .update({
      nda_accepted_at: nowIso,
      nda_version: CURRENT_NDA_VERSION,
      nda_signer_name: signerName,
      nda_signer_user_id: user.id,
      nda_signer_ip: ip,
    })
    .eq("id", organization.id);

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  await recordAuditLog({
    userId: user.id,
    action: "nda_accepted",
    metadata: {
      organizationId: organization.id,
      version: CURRENT_NDA_VERSION,
      signerName,
      email: user.email ?? null,
    },
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  // 署名済み NDA の PDF 生成 + メール送付は応答をブロックしないよう after で実行。
  // 失敗しても同意記録自体は成立している(メールは控え)。
  const toEmail = user.email ?? null;
  if (toEmail) {
    after(async () => {
      try {
        const html = buildNdaHtml({
          organizationName: organization.name,
          signerName,
          acceptedAt: nowIso,
          version: CURRENT_NDA_VERSION,
          ipAddress: ip,
        });
        const pdf = await generatePdfFromHtml(html);
        const res = await sendSignedNdaEmail({
          toEmail,
          organizationName: organization.name,
          signerName,
          version: CURRENT_NDA_VERSION,
          pdfBuffer: pdf,
        });
        if (!res.sent) {
          console.warn("[nda/accept] signed NDA email not sent", { reason: res.reason });
        }
      } catch (err) {
        console.warn("[nda/accept] pdf/email failed", err);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    acceptedAt: nowIso,
    version: CURRENT_NDA_VERSION,
    emailSentTo: toEmail,
  });
}

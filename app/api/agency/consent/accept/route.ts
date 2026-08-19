import { after, NextResponse } from "next/server";
import { z } from "zod";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { recordAuditLog } from "@/lib/audit/audit-log";
import {
  type ConsentAttachment,
  sendSignedLegalConsentEmail,
} from "@/lib/email/signed-legal-consent";
import { CURRENT_NDA_VERSION } from "@/lib/nda/nda-content";
import { buildNdaHtml } from "@/lib/nda/nda-html";
import { generatePdfFromHtml } from "@/lib/pdf/generate";
import { createServiceClient } from "@/lib/supabase/service";
import { CURRENT_TERMS_VERSION } from "@/lib/terms/terms-content";
import { buildTermsHtml } from "@/lib/terms/terms-html";

/**
 * POST /api/agency/consent/accept
 *
 * エージェント組織の法的合意(NDA / 利用規約)に、組織の管理者が代表して同意した
 * 記録を残す。両方を同時に、または未同意のものだけを署名できる複合ゲート。
 *
 * - 認可:organization_member かつ role=admin のみ(代表署名は管理者に限定)。
 * - organizations.nda_* / terms_* を service_role で更新(管理者本人であることを検証済み)。
 * - audit_logs に nda_accepted / terms_accepted を記録(証跡)。
 * - 署名した書類の PDF を 1 通のメールにまとめて署名者の登録メールに送付(応答後 after)。
 */
const bodySchema = z
  .object({
    signerName: z.string().trim().min(1, "氏名を入力してください").max(100),
    agreedNda: z.boolean().optional(),
    agreedTerms: z.boolean().optional(),
  })
  .refine((d) => d.agreedNda === true || d.agreedTerms === true, {
    message: "同意する書類が選択されていません",
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

  // 組織を代表しての同意は管理者のみ。
  if (member.role !== "admin") {
    return NextResponse.json(
      { error: "admin_only", message: "同意は組織の管理者のみ可能です。" },
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
  // after のクロージャで再ナローイングが外れないよう、boolean は const に確定させる。
  const acceptedNda = parsed.data.agreedNda === true;
  const acceptedTerms = parsed.data.agreedTerms === true;
  const nowIso = new Date().toISOString();
  const ip = firstIp(request.headers.get("x-forwarded-for"));
  // organization はガードの const だが、after のクロージャに閉じ込める値を先に確定。
  const organizationId = organization.id;
  const organizationName = organization.name;

  // 記録は service_role で organizations を更新(管理者本人であることは上で検証済み)。
  // 同意した書類のカラムだけを更新する。
  const update: Record<string, unknown> = {};
  if (acceptedNda) {
    update.nda_accepted_at = nowIso;
    update.nda_version = CURRENT_NDA_VERSION;
    update.nda_signer_name = signerName;
    update.nda_signer_user_id = user.id;
    update.nda_signer_ip = ip;
  }
  if (acceptedTerms) {
    update.terms_accepted_at = nowIso;
    update.terms_version = CURRENT_TERMS_VERSION;
    update.terms_signer_name = signerName;
    update.terms_signer_user_id = user.id;
    update.terms_signer_ip = ip;
  }

  const admin = createServiceClient();
  const { error } = await admin.from("organizations").update(update).eq("id", organizationId);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // 監査ログは書類ごとに 1 行ずつ残す(どちらに同意したかを個別に追える)。
  if (acceptedNda) {
    await recordAuditLog({
      userId: user.id,
      action: "nda_accepted",
      metadata: {
        organizationId,
        version: CURRENT_NDA_VERSION,
        signerName,
        email: user.email ?? null,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
  }
  if (acceptedTerms) {
    await recordAuditLog({
      userId: user.id,
      action: "terms_accepted",
      metadata: {
        organizationId,
        version: CURRENT_TERMS_VERSION,
        signerName,
        email: user.email ?? null,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
  }

  // 署名した書類の PDF 生成 + メール送付は応答をブロックしないよう after で実行。
  // 失敗しても同意記録自体は成立している(メールは控え)。
  const toEmail = user.email ?? null;
  if (toEmail) {
    after(async () => {
      try {
        const attachments: ConsentAttachment[] = [];
        if (acceptedNda) {
          const html = buildNdaHtml({
            organizationName,
            signerName,
            acceptedAt: nowIso,
            version: CURRENT_NDA_VERSION,
            ipAddress: ip,
          });
          attachments.push({ kind: "nda", pdfBuffer: await generatePdfFromHtml(html) });
        }
        if (acceptedTerms) {
          const html = buildTermsHtml({
            organizationName,
            signerName,
            acceptedAt: nowIso,
            ipAddress: ip,
          });
          attachments.push({ kind: "terms", pdfBuffer: await generatePdfFromHtml(html) });
        }
        if (attachments.length > 0) {
          const res = await sendSignedLegalConsentEmail({
            toEmail,
            organizationName,
            signerName,
            attachments,
          });
          if (!res.sent) {
            console.warn("[consent/accept] signed consent email not sent", { reason: res.reason });
          }
        }
      } catch (err) {
        console.warn("[consent/accept] pdf/email failed", err);
      }
    });
  }

  return NextResponse.json({
    ok: true,
    acceptedAt: nowIso,
    acceptedNda,
    acceptedTerms,
    emailSentTo: toEmail,
  });
}

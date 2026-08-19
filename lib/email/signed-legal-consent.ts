/**
 * 署名済みの法的合意(NDA / 利用規約)の控えメール。
 *
 * エージェント組織の管理者が同意ゲートで署名したとき、署名者の登録メールに、
 * 今回署名した書類(NDA・利用規約のうち同意したもの)の PDF を 1 通にまとめて
 * 添付して送付する(同意の証跡・控え)。
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, renderEmailLayout } from "./layout";

export type SendSignedLegalConsentResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

/** 今回署名した書類の種別と PDF。 */
export type ConsentDocKind = "nda" | "terms";
export type ConsentAttachment = { kind: ConsentDocKind; pdfBuffer: Buffer };

const DOC_LABEL: Record<ConsentDocKind, string> = {
  nda: "秘密保持契約(NDA)",
  terms: "利用規約",
};

// メール添付のファイル名は互換性重視で ASCII に統一する(本文で日本語ラベルを明示)。
const DOC_FILENAME: Record<ConsentDocKind, string> = {
  nda: "Myaira_NDA.pdf",
  terms: "Myaira_Terms.pdf",
};

export async function sendSignedLegalConsentEmail(args: {
  toEmail: string;
  organizationName: string;
  signerName: string;
  attachments: ConsentAttachment[];
}): Promise<SendSignedLegalConsentResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };
  // 添付が 1 つも無い場合は送らない(呼び出し側のロジック不整合の保険)。
  if (args.attachments.length === 0) return { sent: false, reason: "not_configured" };

  const docList = args.attachments.map((a) => DOC_LABEL[a.kind]).join("・");

  const subject = `【Myaira】ご署名の控え(${docList})`;
  const bodyHtml = `
    <p>${escapeHtml(args.signerName)} 様</p>
    <p>Myaira の${escapeHtml(docList)}へのご同意ありがとうございます。同意内容の控えを PDF で添付いたします。</p>
    ${infoCard(
      // infoRow は内部で escape するので二重エスケープしない。
      infoRow("組織名", args.organizationName) +
        infoRow("署名者", args.signerName) +
        infoRow("同意書類", docList),
    )}
    <p>本メールは同意記録の控えです。大切に保管してください。</p>
  `;
  const html = renderEmailLayout({ previewTitle: subject, bodyHtml });
  const text = [
    `${args.signerName} 様`,
    "",
    `Myaira の${docList}にご同意いただきありがとうございます。同意内容の控えを PDF で添付します。`,
    `組織名: ${args.organizationName}`,
    `署名者: ${args.signerName}`,
    `同意書類: ${docList}`,
  ].join("\n");

  const resendAttachments = args.attachments.map((a) => ({
    filename: DOC_FILENAME[a.kind],
    content: a.pdfBuffer.toString("base64"),
    content_type: "application/pdf",
  }));

  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text, attachments: resendAttachments },
    { label: "email.signed-legal-consent" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

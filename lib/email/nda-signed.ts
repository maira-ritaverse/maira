/**
 * 署名済み NDA(秘密保持契約)の控えメール。
 *
 * エージェント組織の管理者が NDA に同意したとき、署名者の登録メールに
 * 署名済み NDA の PDF を添付して送付する(同意の証跡・控え)。
 */
import { sendResendEmail } from "@/lib/email/resend-client";
import { escapeHtml, infoCard, infoRow, renderEmailLayout } from "./layout";

export type SendSignedNdaResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export async function sendSignedNdaEmail(args: {
  toEmail: string;
  organizationName: string;
  signerName: string;
  version: string;
  /** NDA PDF(署名記録入り) */
  pdfBuffer: Buffer;
}): Promise<SendSignedNdaResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const subject = "【Myaira】秘密保持契約(NDA)同意の控え";
  const bodyHtml = `
    <p>${escapeHtml(args.signerName)} 様</p>
    <p>Myaira の秘密保持契約(NDA)へのご同意ありがとうございます。同意内容の控えを PDF で添付いたします。</p>
    ${infoCard(
      // infoRow は内部で escape するので二重エスケープしない。
      infoRow("組織名", args.organizationName) + infoRow("署名者", args.signerName),
    )}
    <p>本メールは同意記録の控えです。大切に保管してください。</p>
  `;
  const html = renderEmailLayout({ previewTitle: subject, bodyHtml });
  const text = [
    `${args.signerName} 様`,
    "",
    "Myaira の秘密保持契約(NDA)にご同意いただきありがとうございます。同意内容の控えを PDF で添付します。",
    `組織名: ${args.organizationName}`,
    `署名者: ${args.signerName}`,
  ].join("\n");

  const pdfBase64 = args.pdfBuffer.toString("base64");
  const result = await sendResendEmail(
    {
      from,
      to: [args.toEmail],
      subject,
      html,
      text,
      attachments: [
        { filename: "Myaira_NDA.pdf", content: pdfBase64, content_type: "application/pdf" },
      ],
    },
    { label: "email.nda-signed" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

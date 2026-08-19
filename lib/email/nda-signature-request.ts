/**
 * NDA(秘密保持契約)署名依頼のリマインドメール。
 *
 * 運営者(または将来的にエージェント管理者)が手動で送る「ログインして NDA に署名して
 * ください」のリマインド。署名自体はアプリ内の同意ゲートで行う(自動ゲートが見えない等の
 * フォールバック用途)。
 */
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { sendResendEmail } from "@/lib/email/resend-client";
import { escapeHtml, primaryButton, renderEmailLayout } from "./layout";

export type SendNdaSignatureRequestResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export async function sendNdaSignatureRequestEmail(args: {
  toEmail: string;
  organizationName: string;
}): Promise<SendNdaSignatureRequestResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const subject = "【Myaira】秘密保持契約(NDA)へのご署名のお願い";
  const url = buildAbsoluteUrl("/agency");
  const bodyHtml = `
    <p>${escapeHtml(args.organizationName)} ご担当者様</p>
    <p>Myaira のご利用にあたり、秘密保持契約(NDA)へのご同意(ご署名)をお願いしております。</p>
    <p>下記より Myaira にログインいただくと、NDA の同意画面が表示されます。組織の管理者アカウントでご署名ください。</p>
    ${primaryButton(url, "Myaira にログインして署名する")}
    <p>ご署名後、署名済みの控え(PDF)をメールでお送りします。</p>
  `;
  const html = renderEmailLayout({ previewTitle: subject, bodyHtml });
  const text = [
    `${args.organizationName} ご担当者様`,
    "",
    "Myaira のご利用にあたり、秘密保持契約(NDA)へのご署名をお願いしております。",
    "以下からログインすると同意画面が表示されます。管理者アカウントでご署名ください。",
    url,
    "",
    "ご署名後、署名済みの控え(PDF)をメールでお送りします。",
  ].join("\n");

  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text },
    { label: "email.nda-signature-request" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

/**
 * 資料 請求 (リード 獲得) 通知 メール
 *
 * 1 つ の フォーム 送信 で 2 通 を 送る:
 *   ・運営 宛 (= 営業 リスト 化 のための 通知)
 *   ・申込 者 宛 (= 「資料 を 後日 お送り します」 の 自動 返信)
 *
 * 資料 (PDF) は 当面 「営業 担当 が 手動 で 返信」 想定。 申込 者 宛 は 受領
 * の 確認 + 連絡 が 行く 旨 を 約束 する だけ で、 直接 添付 は しない。
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type LeadRequestPayload = {
  companyName: string;
  contactName: string;
  email: string;
  phone?: string | null;
  /** 何 で Maira を 知った か */
  source?: string | null;
  /** 自由 記述 (要望 / 質問) */
  notes?: string | null;
};

export type SendLeadRequestResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

const OPERATOR_INBOX = process.env.LEAD_REQUEST_INBOX || process.env.EMAIL_FROM || null;

/** 運営 宛: 営業 リード 通知 */
export async function sendLeadRequestNotificationToOperator(
  payload: LeadRequestPayload,
): Promise<SendLeadRequestResult> {
  const from = process.env.EMAIL_FROM;
  if (!from || !OPERATOR_INBOX) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = `【Maira 資料 請求】${payload.companyName} / ${payload.contactName} 様`;

  const text = [
    `Maira の 資料 請求 が 届きました。`,
    ``,
    `会社 名: ${payload.companyName}`,
    `担当 者: ${payload.contactName}`,
    `メール: ${payload.email}`,
    payload.phone ? `電話: ${payload.phone}` : null,
    payload.source ? `流入 元: ${payload.source}` : null,
    payload.notes ? `\n要望 / 質問:\n${payload.notes}` : null,
    ``,
    `※ 24 時間 以内 に 連絡 が 期待 されて いる ため、 早急 な 返信 を。`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:18px;line-height:1.4;">Maira 資料 請求</h2>
${infoCard(
  infoRow("会社 名", payload.companyName) +
    infoRow("担当 者", payload.contactName) +
    infoRow("メール", payload.email) +
    (payload.phone ? infoRow("電話", payload.phone) : "") +
    (payload.source ? infoRow("流入 元", payload.source) : ""),
)}
${
  payload.notes
    ? `<div style="margin-top:16px;padding:12px;background:#f7f7f7;border-radius:6px;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(payload.notes)}</div>`
    : ""
}
<p style="margin:20px 0 0;font-size:12px;color:#888;">24 時間 以内 の 返信 が 期待 され て いま す。</p>
`.trim();

  return toResult(
    await sendResendEmail(
      {
        from,
        to: [OPERATOR_INBOX],
        subject,
        text,
        html: renderEmailLayout({ previewTitle: subject, bodyHtml: body }),
      },
      { label: "email.lead-request-operator" },
    ),
  );
}

/** 申込 者 宛: 自動 返信 (= 受領 確認) */
export async function sendLeadRequestAutoReply(
  payload: LeadRequestPayload,
): Promise<SendLeadRequestResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = `【Maira】 資料 請求 を 受け付け ました`;

  const text = [
    `${payload.contactName} 様`,
    ``,
    `この 度 は Maira の 資料 を ご請求 いただき ありがとう ござい ます。`,
    ``,
    `1 営業 日 以内 に 担当 から 資料 PDF と 簡単 な ご紹介 を お送り します。`,
    `お急ぎ の 場合 は こちら の メール に 直接 ご返信 ください。`,
    ``,
    `Maira 運営 チーム`,
    `https://www.maira.pro`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:18px;line-height:1.4;">資料 請求 を 受け付け ました</h2>
<p style="margin:0 0 12px;color:#333;line-height:1.7;font-size:14px;">
  ${escapeHtml(payload.contactName)} 様<br><br>
  この 度 は Maira の 資料 を ご請求 いただき ありがとう ござい ます。<br>
  1 営業 日 以内 に 担当 から 資料 PDF と 簡単 な ご紹介 を お送り します。
</p>
<p style="margin:0 0 16px;color:#555;line-height:1.7;font-size:13px;">
  お急ぎ の 場合 は 本 メール に 直接 ご返信 ください。
</p>
<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton("https://www.maira.pro", "Maira を 詳しく 見る")}
</div>
<p style="margin:24px 0 0;font-size:12px;color:#888;">Maira 運営 チーム</p>
`.trim();

  return toResult(
    await sendResendEmail(
      {
        from,
        to: [payload.email],
        subject,
        text,
        html: renderEmailLayout({ previewTitle: subject, bodyHtml: body }),
      },
      { label: "email.lead-request-auto-reply" },
    ),
  );
}

// C2-1: sendResendEmail の 結果 型 を lead-request 内 用 の Union 型 に 変換。
function toResult(r: Awaited<ReturnType<typeof sendResendEmail>>): SendLeadRequestResult {
  if (r.sent) return { sent: true, messageId: r.messageId };
  if (r.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: r.error };
}

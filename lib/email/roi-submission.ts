/**
 * ROI 試算 ( マーケ リード ) 通知 メール
 *
 * /roi ページ で 「試算 結果 を 送る」 を 押した 際 の 通知:
 *   ・運営 宛 ( = 営業 リスト 化 + 試算 結果 確認 )
 *   ・申込 者 宛 ( = 試算 結果 + 詳細 資料 の 案内 )
 *
 * lead-request.ts と 同様 の パターン だが、 試算 結果 ( 年間 効果 額 等 ) も
 * メール 本文 に 載せる ので 申込 者 が 経営 層 に 共有 し やすい 形 に する。
 */
import { renderEmailLayout } from "./layout";

export type RoiSubmissionPayload = {
  // 必須
  companyName: string;
  contactName: string;
  email: string;
  // 任意
  role?: string | null;
  phone?: string | null;
  industry?: string | null;
  // ROI 入力 値
  advisorCount: number;
  monthlyClients: number;
  monthlyDeals: number;
  avgFeeManYen: number;
  docMinutesPerCase: number;
  monthlyLostLeads: number | null;
  advisorHourlyYen: number | null;
  // 計算 結果
  yearlyTotalYen: number;
  yearlyDocSavingsYen: number;
  yearlyLeadRecoveryYen: number;
  yearlyDealUpliftYen: number;
};

export type SendRoiSubmissionResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

const OPERATOR_INBOX = process.env.LEAD_REQUEST_INBOX || process.env.EMAIL_FROM || null;

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

/** 運営 宛: ROI 試算 リード 通知 */
export async function sendRoiSubmissionNotificationToOperator(
  payload: RoiSubmissionPayload,
): Promise<SendRoiSubmissionResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from || !OPERATOR_INBOX) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = `【Maira ROI 試算】${payload.companyName} / 年間 ${yen(payload.yearlyTotalYen)}`;

  const text = [
    `Maira の ROI 試算 が 届きました。`,
    ``,
    `■ 会社 情報`,
    `会社 名: ${payload.companyName}`,
    `担当 者: ${payload.contactName}`,
    `メール: ${payload.email}`,
    payload.role ? `役職: ${payload.role}` : null,
    payload.phone ? `電話: ${payload.phone}` : null,
    payload.industry ? `業種: ${payload.industry}` : null,
    ``,
    `■ 試算 結果`,
    `年間 効果 額 (合計): ${yen(payload.yearlyTotalYen)}`,
    `  ├ 書類 作成 時間 削減: ${yen(payload.yearlyDocSavingsYen)}`,
    `  ├ 連絡 漏れ 防止: ${yen(payload.yearlyLeadRecoveryYen)}`,
    `  └ 成約 率 UP: ${yen(payload.yearlyDealUpliftYen)}`,
    ``,
    `■ 入力 値`,
    `アドバイザー 数: ${payload.advisorCount} 名`,
    `月間 求職者 数: ${payload.monthlyClients} 名 / 月`,
    `月間 成約 件数: ${payload.monthlyDeals} 件 / 月`,
    `平均 紹介 料: ${payload.avgFeeManYen} 万円 / 件`,
    `書類 作成 時間: ${payload.docMinutesPerCase} 分 / 件`,
    payload.monthlyLostLeads != null ? `連絡 漏れ: ${payload.monthlyLostLeads} 件 / 月` : null,
    payload.advisorHourlyYen != null ? `平均 時給: ${payload.advisorHourlyYen} 円` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderEmailLayout({
    previewTitle: `${payload.companyName} 様 が ROI 試算 を 完了`,
    bodyHtml: `<pre style="font-family: monospace; font-size: 13px; line-height: 1.7; white-space: pre-wrap;">${escape(text)}</pre>`,
  });

  return await sendViaResend({ apiKey, from, to: OPERATOR_INBOX, subject, text, html });
}

/** 申込 者 宛: 試算 結果 + 詳細 資料 の 案内 */
export async function sendRoiSubmissionAutoReply(
  payload: RoiSubmissionPayload,
): Promise<SendRoiSubmissionResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = `【Maira】${payload.companyName} 様 の ROI 試算 結果`;

  const text = [
    `${payload.contactName} 様`,
    ``,
    `Maira の ROI 試算 を ご利用 いただき ありがとう ござい ます。`,
    `${payload.companyName} 様 の 試算 結果 を お送り します。`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `年間 効果 額: ${yen(payload.yearlyTotalYen)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `内訳:`,
    `・書類 作成 時間 削減: ${yen(payload.yearlyDocSavingsYen)}`,
    `・連絡 漏れ 防止: ${yen(payload.yearlyLeadRecoveryYen)}`,
    `・成約 率 UP: ${yen(payload.yearlyDealUpliftYen)}`,
    ``,
    `この 試算 を 元 に、 詳細 な 機能 紹介 / 導入 事例 を 営業 担当 から 1 営業 日 以内 に お送り いたします。`,
    ``,
    `ご質問 等 が ござい ましたら support@maira.pro まで お気軽 に ご連絡 ください。`,
    ``,
    `― Maira 運営 (株式会社Revorise)`,
    `https://www.maira.pro`,
  ].join("\n");

  const html = renderEmailLayout({
    previewTitle: `ROI 試算 結果: 年間 ${yen(payload.yearlyTotalYen)}`,
    bodyHtml: `<pre style="font-family: 'Hiragino Sans', sans-serif; font-size: 14px; line-height: 1.8; white-space: pre-wrap;">${escape(text)}</pre>`,
  });

  return await sendViaResend({ apiKey, from, to: payload.email, subject, text, html });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendRoiSubmissionResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        html: args.html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { sent: false, reason: "send_failed", error: `${res.status}: ${errText}` };
    }
    const j = (await res.json().catch(() => null)) as { id?: string | null } | null;
    return { sent: true, messageId: j?.id ?? null };
  } catch (e) {
    return {
      sent: false,
      reason: "send_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

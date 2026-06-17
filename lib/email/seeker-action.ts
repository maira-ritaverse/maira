/**
 * 求職者アクション(興味あり / 応募を依頼)→ エージェントへのメール通知
 *
 * - RESEND_API_KEY / EMAIL_FROM 未設定なら no-op(reason: "not_configured")
 * - エージェント全員ではなく、組織管理者の代表メール 1 件にだけ送る方針
 *   (個別通知は in-app で十分。メールは「外出中も気付ける」用途)
 *
 * 求職者の内面情報は本文に載せない(名前 + 求人 + アクション種別のみ)。
 *
 * HTML は共通レイアウト(./layout)で他のメールとデザイン統一。
 */
import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendSeekerActionEmailArgs = {
  toEmail: string;
  organizationName: string;
  clientName: string;
  jobLabel: string;
  /** "興味あり" or "応募を依頼" */
  actionLabel: string;
  /** クリック先(エージェント側) */
  href: string;
};

export type SendSeekerActionEmailResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export async function sendSeekerActionEmail(
  args: SendSeekerActionEmailArgs,
): Promise<SendSeekerActionEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  const subject = `[${args.organizationName}] ${args.clientName} さんが ${args.jobLabel} に「${args.actionLabel}」`;
  const text = [
    `${args.organizationName} の管理画面に新しいシグナルがあります。`,
    "",
    `求職者: ${args.clientName}`,
    `求人: ${args.jobLabel}`,
    `アクション: ${args.actionLabel}`,
    "",
    `詳細を開く: ${args.href}`,
    "",
    "※ このメールは Maira から自動送信されています。",
  ].join("\n");

  // HTML 版(Resend は html フィールドに対応、text と併存可能)
  const html = buildHtmlBody({
    organizationName: args.organizationName,
    clientName: args.clientName,
    jobLabel: args.jobLabel,
    actionLabel: args.actionLabel,
    href: args.href,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [args.toEmail], subject, text, html }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { sent: false, reason: "send_failed", error: `${res.status} ${t.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, messageId: json?.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

/**
 * 求職者アクション通知メールの HTML 本文を生成する純関数。
 * 共通レイアウト(renderEmailLayout)で他のメールとデザイン統一。
 */
export function buildHtmlBody(args: {
  organizationName: string;
  clientName: string;
  jobLabel: string;
  actionLabel: string;
  href: string;
}): string {
  const body = `
<h2 style="margin:0 0 8px;font-size:20px;line-height:1.4;">求職者からの新しいシグナル</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  <strong>${escapeHtml(args.clientName)}</strong> さんが
  <strong>${escapeHtml(args.jobLabel)}</strong> に対して
  「<strong>${escapeHtml(args.actionLabel)}</strong>」を表明しました。
</p>

${infoCard(
  infoRow("求職者", args.clientName) +
    infoRow("求人", args.jobLabel) +
    infoRow("アクション", args.actionLabel),
)}

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.href, "詳細を開く")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  通知を受け取りたくない場合は、管理画面の「設定 → 通知購読設定」で OFF にできます。
</p>
`.trim();

  return renderEmailLayout({
    previewTitle: `${args.organizationName} - 求職者アクション通知`,
    bodyHtml: body,
  });
}

/**
 * 求職者アクション(興味あり / 応募を依頼)→ エージェントへのメール通知
 *
 * - RESEND_API_KEY / EMAIL_FROM 未設定なら no-op(reason: "not_configured")
 * - エージェント全員ではなく、組織管理者の代表メール 1 件にだけ送る方針
 *   (個別通知は in-app で十分。メールは「外出中も気付ける」用途)
 *
 * 求職者の内面情報は本文に載せない(名前 + 求人 + アクション種別のみ)。
 */

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
 *
 * - インラインスタイルのみ(Gmail / iOS メール / Outlook 互換)
 * - ボタンは <a> + 背景色のシンプルな見た目
 * - ダークモード対応は省略(メールクライアント側で反転される)
 */
export function buildHtmlBody(args: {
  organizationName: string;
  clientName: string;
  jobLabel: string;
  actionLabel: string;
  href: string;
}): string {
  const esc = htmlEscape;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${esc(args.organizationName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f4;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;border:1px solid #e7e5e4;padding:32px;">
        <tr>
          <td>
            <p style="margin:0 0 8px;font-size:12px;color:#78716c;letter-spacing:0.04em;">MAIRA / ${esc(args.organizationName)}</p>
            <h1 style="margin:0 0 16px;font-size:18px;line-height:1.5;color:#1c1917;">求職者からの新しいシグナルがあります</h1>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#44403c;">
              <strong>${esc(args.clientName)}</strong> さんが <strong>${esc(args.jobLabel)}</strong> に対して<br>
              「<strong>${esc(args.actionLabel)}</strong>」を表明しました。
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#10b981;border-radius:6px;">
                  <a href="${esc(args.href)}" style="display:inline-block;padding:10px 20px;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;">
                    詳細を開く →
                  </a>
                </td>
              </tr>
            </table>

            <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e7e5e4;">
            <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.5;">
              このメールは Maira から自動送信されています。<br>
              通知を受け取りたくない場合は、管理画面の「設定 → 通知購読設定」で OFF にできます。
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

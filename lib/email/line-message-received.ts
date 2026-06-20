/**
 * LINE 新着 メッセージ 通知 メール (Resend)
 *
 * 送信 タイミング:
 *   求職者 (LINE 友達) から エージェント企業 公式LINE に メッセージ が 届いた 時。
 *   organizations の admin 全員 に 1 通 ずつ。
 *
 * UX 注意:
 *   ・本文 プレビュー は 短縮済 (40 字程度) を 渡す
 *   ・機密 内容 ベタ書き は 避ける (リンクで Maira 内 で 確認 する 動線)
 */
import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendLineMessageResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendLineMessageArgs = {
  toEmail: string;
  organizationName: string;
  /** 求職者 表示名 (client_record.name か LINE displayName) */
  senderLabel: string;
  /** メッセージ 本文 プレビュー (40 字 程度) */
  preview: string;
  /** /agency/line/[lineUserId] への フル URL */
  conversationUrl: string;
};

export async function sendLineMessageEmail(
  args: SendLineMessageArgs,
): Promise<SendLineMessageResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  const subject = `【Maira / LINE】${args.senderLabel} さん から 新着`;

  const text = [
    `${args.organizationName} 様`,
    ``,
    `${args.senderLabel} さん から 公式LINE に メッセージ が 届きました。`,
    ``,
    `> ${args.preview}`,
    ``,
    `下記 リンク から 返信 できます (30 秒以内 の Reply は 無料)。`,
    args.conversationUrl,
    ``,
    `Maira 運営チーム`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:18px;line-height:1.4;">LINE 新着 メッセージ</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(args.organizationName)} 様<br><br>
  <strong>${escapeHtml(args.senderLabel)}</strong> さん から 公式LINE に メッセージ が 届きました。
</p>

${infoCard(infoRow("差出人", args.senderLabel) + infoRow("プレビュー", args.preview))}

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.conversationUrl, "Maira で 返信 する")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ LINE Reply Token は 受信から 30 秒 で 失効 します。 すぐに 返信 すると 無料、 過ぎていれば Push (1 通 課金) に なります。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [args.toEmail],
        subject,
        text,
        html,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { sent: false, reason: "send_failed", error: errorText };
    }
    const json = (await response.json()) as { id?: string };
    return { sent: true, messageId: json.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

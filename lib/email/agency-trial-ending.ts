/**
 * エージェント企業 トライアル 終了通知 メール (Resend)
 *
 * 送信 タイミング:
 *   ・残 7 日:アップグレード継続 を 選んで もらう ため (主要 通知)
 *   ・残 1 日:最終 リマインダ
 *
 * Stripe 契約 後 は CTA リンク を /agency/settings/billing に 向け、
 * そこで Stripe Customer Portal や プラン変更 を 実施 する 流れ。
 * 現在 (Stripe 契約 前) は 同じ ページで 「アップグレード継続 を 選択」 する だけ。
 */
import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendTrialEndingResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendTrialEndingArgs = {
  toEmail: string;
  organizationName: string;
  /** 残 日数 (7 or 1) */
  daysRemaining: number;
  /** トライアル 終了日 (YYYY-MM-DD 表示用) */
  trialEndsOn: string;
  /** /agency/settings/billing へ の フル URL */
  billingUrl: string;
};

export async function sendTrialEndingEmail(
  args: SendTrialEndingArgs,
): Promise<SendTrialEndingResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  const headline =
    args.daysRemaining === 1
      ? "明日 で 無料期間 が 終了 します"
      : `あと ${args.daysRemaining} 日 で 無料期間 が 終了 します`;

  const subject = `【Maira】${args.organizationName} 様 — ${headline}`;

  const text = [
    `${args.organizationName} 様`,
    ``,
    `Maira を ご利用 いただき ありがとう ございます。`,
    ``,
    `${headline} (終了日:${args.trialEndsOn})。`,
    ``,
    `トライアル 期間中 は すべての 機能 (録音 / Pro / Premium) を お試し`,
    `いただけます。 終了後 も 継続して 利用したい アップグレード が あれば、`,
    `下記 ページ から ご選択 ください。`,
    ``,
    args.billingUrl,
    ``,
    `※ 何も 選択 されない 場合、 終了後 は Standard プラン (¥25,000 / 月)`,
    `  のみの 契約 と なります (録音 / Pro / Premium は 解除 されます)。`,
    ``,
    `※ クレジットカード 登録 済みの 場合、 翌日 から 自動 課金 開始 されます。`,
    `  解約 を ご希望 の 場合 は 上記 ページ から 期末解約 を ご選択 ください。`,
    ``,
    `Maira 運営チーム`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:20px;line-height:1.4;">${escapeHtml(headline)}</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(args.organizationName)} 様<br><br>
  Maira を ご利用 いただき ありがとう ございます。<br>
  ${escapeHtml(headline)}。 トライアル 期間中 は すべての 機能 (録音 / Pro / Premium) を お試し いただけます。
</p>

${infoCard(
  infoRow("トライアル 終了日", args.trialEndsOn) +
    infoRow("残 日数", `${args.daysRemaining} 日`) +
    infoRow("終了後 の 既定", "Standard プラン (¥25,000 / 月)"),
)}

<p style="margin:20px 0 12px;color:#555;line-height:1.6;font-size:14px;">
  終了後 も 継続して 利用したい アップグレード (録音 / Pro / Premium) が あれば、 下記 ページ から ご選択 ください。 何も 選択 されない 場合、 Standard のみ の 契約 と なります。
</p>

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.billingUrl, "アップグレード を 選択 する")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ クレジットカード 登録 済みの 場合、 翌日 から 自動 課金 開始 されます。<br>
  ※ 解約 を ご希望 の 場合 は 上記 ページ から 期末解約 を ご選択 ください。
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

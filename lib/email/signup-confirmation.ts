/**
 * メールアドレス確認(再送)用メール送信(Resend)
 *
 * 経緯:
 *   ・新規登録の確認メールは Supabase 内蔵メール(signUp 経由)で送られ、
 *     - PKCE の ConfirmationURL(/auth/callback)で 別端末 / アプリ内ブラウザ だと失敗
 *     - 内蔵メールは到達率が低くレート制限も厳しい
 *     という二重苦がある。
 *   ・そこで リセット(password-reset.ts)と同じく、generateLink で hashed_token を
 *     取り、独自エンドポイント /auth/confirm で verifyOtp に渡す方式のリンクを、
 *     Resend で送る「確認メール再送」導線を用意する(別端末 OK・到達率改善)。
 *
 * 共通レイアウト(./layout)で他のメールとデザイン統一。
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendSignupConfirmationEmailResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendSignupConfirmationEmailArgs = {
  toEmail: string;
  /** /auth/confirm?token_hash=...&type=magiclink&next=/app の URL */
  actionLink: string;
};

export async function sendSignupConfirmationEmail(
  args: SendSignupConfirmationEmailArgs,
): Promise<SendSignupConfirmationEmailResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const subject = "【Myaira】メールアドレスの確認をお願いします";

  const text = [
    `Myaira へのご登録ありがとうございます。`,
    ``,
    `下記のリンクを開くと、メールアドレスの確認が完了し、そのままログインできます。`,
    args.actionLink,
    ``,
    `※ このリンクの有効期限は 1 時間です。別のスマホ / パソコンで開いても問題ありません。`,
    `※ このメールに心当たりが無い場合は破棄してください。`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:20px;line-height:1.4;">メールアドレスの確認</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  Myaira へのご登録ありがとうございます。<br>
  下記のボタンを開くと、メールアドレスの確認が完了し、そのままログインできます。
</p>

${infoCard(infoRow("確認先メールアドレス", args.toEmail) + infoRow("リンク有効期限", "1 時間"))}

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.actionLink, "メールアドレスを確認する")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ボタンが押せない場合は、下記の URL をブラウザに貼り付けてアクセスしてください。<br>
  <span style="word-break:break-all;color:#555;">${escapeHtml(args.actionLink)}</span>
</p>

<p style="margin:16px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ 別のスマートフォン / パソコンで開いても確認できます。<br>
  ※ このメールに心当たりが無い場合は破棄してください。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text },
    { label: "email.signup-confirmation" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

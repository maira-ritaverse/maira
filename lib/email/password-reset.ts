/**
 * パスワードリセット用メール送信(Resend)
 *
 * 経緯:
 *   ・Supabase 標準の resetPasswordForEmail() は英語デフォルトテンプレート
 *     で送られ、かつ /auth/v1/verify → /auth/callback の exchangeCodeForSession
 *     フローを前提とするため、別ブラウザ / 別端末でリンクを開いた際に
 *     PKCE code_verifier が無く失敗する。
 *   ・generateLink({type:'recovery'}) で hashed_token だけ取って、独自エンド
 *     ポイント /auth/confirm で verifyOtp に渡す方式へ切り替えた。
 *
 * 共通レイアウト(./layout)で他のメールとデザイン統一。
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendPasswordResetEmailResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendPasswordResetEmailArgs = {
  toEmail: string;
  /** /auth/confirm?token_hash=...&type=recovery&next=/reset-password の URL */
  actionLink: string;
};

export async function sendPasswordResetEmail(
  args: SendPasswordResetEmailArgs,
): Promise<SendPasswordResetEmailResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const subject = "【Myaira】パスワードの再設定リンクをお送りします";

  const text = [
    `Myaira のパスワード再設定リクエストを受け付けました。`,
    ``,
    `下記のリンクから新しいパスワードを設定してください。`,
    args.actionLink,
    ``,
    `※ このリンクの有効期限は 1 時間です。`,
    `※ このメールに心当たりが無い場合は破棄してください。お客様のアカウントは安全です。`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:20px;line-height:1.4;">パスワードの再設定</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  Myaira のパスワード再設定リクエストを受け付けました。<br>
  下記のボタンから新しいパスワードを設定してください。
</p>

${infoCard(infoRow("リクエスト先メールアドレス", args.toEmail) + infoRow("リンク有効期限", "1 時間"))}

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.actionLink, "新しいパスワードを設定する")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ボタンが押せない場合は、下記の URL をブラウザに貼り付けてアクセスしてください。<br>
  <span style="word-break:break-all;color:#555;">${escapeHtml(args.actionLink)}</span>
</p>

<p style="margin:16px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ このメールに心当たりが無い場合は破棄してください。お客様のアカウントは安全です。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  // C2-1: Resend wrapper 経由 (リトライ 込 み)。
  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text },
    { label: "email.password-reset" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

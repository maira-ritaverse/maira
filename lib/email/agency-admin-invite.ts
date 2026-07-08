/**
 * エージェント企業管理者向けの招待メール送信(Resend)
 *
 * 用途:
 *   運営者が /admin/organizations から新規エージェント企業を発行したとき、
 *   その企業の管理者(adminEmail)に届く招待メール。
 *
 * 設計判断:
 *   ・Supabase Auth の inviteUserByEmail() は標準テンプレート(英語の
 *     "You've been invited" 件名)で送信されてしまうため、UX が壊れる。
 *   ・このため auth.admin.generateLink({ type: "invite" }) でアクション
 *     リンクだけ取り、メール送信は Resend 経由の自前 HTML に切り替える。
 *   ・action_link をクリック → /auth/callback?next=/reset-password に
 *     着地して、パスワード設定画面に誘導する。
 *
 * RESEND_API_KEY / EMAIL_FROM 未設定なら no-op で返す(開発環境向け)。
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendAgencyAdminInviteResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendAgencyAdminInviteArgs = {
  toEmail: string;
  organizationName: string;
  /** Supabase の generateLink({type:"invite"}) で返ってくる action_link。
   *  クリックでメール確認 + セッション発行 → redirectTo の /auth/callback に着地。 */
  actionLink: string;
};

export async function sendAgencyAdminInviteEmail(
  args: SendAgencyAdminInviteArgs,
): Promise<SendAgencyAdminInviteResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const subject = `【Maira】${args.organizationName} の管理者アカウント発行のご案内`;

  const text = [
    `${args.organizationName} の管理者として Maira にご招待いただきました。`,
    ``,
    `下記リンクからアカウントを有効化し、パスワードをご設定ください。`,
    args.actionLink,
    ``,
    `※招待されたメールアドレス(${args.toEmail})宛にのみ有効です。`,
    `※リンクの有効期限は 24 時間です。期限切れの場合はログイン画面の`,
    `  「パスワードをお忘れですか?」から再発行できます。`,
    ``,
    `※このメールに心当たりが無い場合は破棄してください。`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:20px;line-height:1.4;">${escapeHtml(args.organizationName)} 管理者アカウントのご案内</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(args.organizationName)} の管理者として Maira にご招待いただきました。<br>
  下記のボタンからアカウントを有効化し、パスワードをご設定ください。
</p>

${infoCard(infoRow("招待先メールアドレス", args.toEmail) + infoRow("リンク有効期限", "24 時間"))}

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.actionLink, "アカウントを有効化してパスワードを設定する")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ボタンが押せない場合は、下記の URL をブラウザに貼り付けてアクセスしてください。<br>
  <span style="word-break:break-all;color:#555;">${escapeHtml(args.actionLink)}</span>
</p>

<p style="margin:16px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※リンクの有効期限が切れた場合は、ログイン画面の「パスワードをお忘れですか?」から再設定できます。<br>
  ※このメールに心当たりが無い場合は破棄してください。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  // C2-1: Resend wrapper 経由 で リトライ 付き 送信。
  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text },
    { label: "email.agency-admin-invite" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

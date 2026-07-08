/**
 * 招待メール送信(Resend)
 *
 * 招待された人が迷わず登録できるよう、メール本文に
 *   ・初めて Maira を使う場合 → 新規登録(パスワード設定)リンク
 *   ・すでに Maira アカウントがある場合 → ログインリンク
 * の 2 本立てで案内する。
 *
 * RESEND_API_KEY と EMAIL_FROM のどちらか未設定なら no-op で返す。
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import {
  escapeHtml,
  infoCard,
  infoRow,
  primaryButton,
  renderEmailLayout,
  secondaryButton,
} from "./layout";

export type SendInvitationResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendInvitationArgs = {
  toEmail: string;
  organizationName: string;
  inviteUrl: string;
  token: string;
  siteUrl: string;
  expiresAt: Date;
};

export async function sendInvitationEmail(args: SendInvitationArgs): Promise<SendInvitationResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const expiresLabel = args.expiresAt.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const base = args.siteUrl.replace(/\/$/, "");
  const signupUrl = `${base}/signup?invitationToken=${encodeURIComponent(args.token)}`;
  const loginUrl = `${base}/login?next=${encodeURIComponent(`/invite/${args.token}`)}`;

  const subject = `【Maira】${args.organizationName} からの招待が届いています`;

  const text = [
    `${args.organizationName} のエージェント管理画面に招待されました。`,
    ``,
    `有効期限:${expiresLabel}(7 日以内)`,
    ``,
    `━━━ 初めて Maira を使う方 ━━━`,
    `下記のリンクから新規登録 + パスワード設定をしてください。`,
    signupUrl,
    ``,
    `━━━ すでに Maira アカウントをお持ちの方 ━━━`,
    `下記のリンクからログインしてください。`,
    loginUrl,
    ``,
    `※招待されたメールアドレス(${args.toEmail})でご登録 / ログインしてください。`,
    `※このメールに心当たりが無い場合は破棄してください。`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:20px;line-height:1.4;">${escapeHtml(args.organizationName)} からの招待</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(args.organizationName)} のエージェント管理画面に招待されました。
</p>

${infoCard(infoRow("有効期限", expiresLabel) + infoRow("招待先メールアドレス", args.toEmail))}

<div style="margin:20px 0 8px;padding:16px;background:#f6f7f9;border-radius:8px;">
  <p style="margin:0 0 6px;font-weight:600;font-size:14px;">初めて Maira を使う方</p>
  <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.6;">
    パスワードを設定してアカウントを作成します。
  </p>
  ${primaryButton(signupUrl, "新規登録してパスワードを設定する")}
</div>

<div style="margin:8px 0 0;padding:16px;background:#f6f7f9;border-radius:8px;">
  <p style="margin:0 0 6px;font-weight:600;font-size:14px;">すでに Maira アカウントをお持ちの方</p>
  <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.6;">
    ログイン後に招待を受け入れてください。
  </p>
  ${secondaryButton(loginUrl, "ログインする")}
</div>

<p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※招待されたメールアドレス(${escapeHtml(args.toEmail)})でご登録 / ログインしてください。<br>
  ※このメールに心当たりが無い場合は破棄してください。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  // C2-1: Resend wrapper 経由 で 送信 (指数 バック オフ リトライ 込 み)。
  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text },
    { label: "email.invitation" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

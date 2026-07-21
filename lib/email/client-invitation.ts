/**
 * 求職者(client_record)向けの 招待メール
 *
 * organization メンバー招待(invitation.ts)とは別文面:
 *   ・対象が求職者なので「キャリア支援の伴走相手として招待」のトーン
 *   ・着地は /signup?clientInvitationToken=... のみ
 *     (求職者は既存ログインのフローに乗らない設計:招待制 + 1 アカウント 1 求職者)
 *
 * RESEND_API_KEY と EMAIL_FROM のどちらか未設定なら no-op で返す。
 * (本番では両方必須、CI / 開発で未設定でも送信を試みないようにする)
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendClientInvitationResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendClientInvitationArgs = {
  toEmail: string;
  /** 求職者の表示名(差出人の文脈で使うので無くても可) */
  seekerName: string;
  organizationName: string;
  /** 担当アドバイザー名(任意) */
  advisorName?: string | null;
  /** 完成済の着地 URL(/signup?clientInvitationToken=...) */
  inviteUrl: string;
  expiresAt: Date;
};

export async function sendClientInvitationEmail(
  args: SendClientInvitationArgs,
): Promise<SendClientInvitationResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) return { sent: false, reason: "not_configured" };

  const expiresLabel = args.expiresAt.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const seekerLabel = args.seekerName?.trim() || "ご担当者";
  const fromLabel = args.advisorName?.trim()
    ? `${args.organizationName}(担当:${args.advisorName})`
    : args.organizationName;

  const subject = `【Myaira】${args.organizationName} からの招待が届いています`;

  const text = [
    `${seekerLabel} 様`,
    ``,
    `${fromLabel} より、転職活動の伴走サービス Myaira への招待が届いています。`,
    ``,
    `Myaira は、応募管理 / 履歴書作成 / 面接練習 / キャリア棚卸し を AI が支援する`,
    `転職活動者向けの Web アプリです。担当エージェントと書類や進捗を安全に共有できます。`,
    ``,
    `下記のリンクから アカウント作成(パスワード設定)を行ってください。`,
    args.inviteUrl,
    ``,
    `有効期限:${expiresLabel}(7 日以内)`,
    ``,
    `※招待されたメールアドレス(${args.toEmail})で登録してください。`,
    `※このメールに心当たりが無い場合は破棄してください。`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:20px;line-height:1.4;">${escapeHtml(fromLabel)} からの招待</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(seekerLabel)} 様<br>
  転職活動の伴走サービス <strong>Myaira</strong> への招待が届いています。
</p>

<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:13px;">
  Myaira は、応募管理 / 履歴書作成 / 面接練習 / キャリア棚卸し を AI が支援する
  Web アプリです。担当エージェントと書類や進捗を安全に共有できます。
</p>

${infoCard(
  infoRow("招待元", fromLabel) +
    infoRow("招待先メールアドレス", args.toEmail) +
    infoRow("有効期限", expiresLabel),
)}

<div style="margin:20px 0 8px;padding:16px;background:#f6f7f9;border-radius:8px;">
  <p style="margin:0 0 6px;font-weight:600;font-size:14px;">アカウントを作成する</p>
  <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.6;">
    下記のボタンから パスワードを設定して Myaira のアカウントを作成してください。
  </p>
  ${primaryButton(args.inviteUrl, "Myaira のアカウントを作成する")}
</div>

<p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※招待されたメールアドレス(${escapeHtml(args.toEmail)})で登録してください。<br>
  ※このメールに心当たりが無い場合は破棄してください。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  // C2-1: Resend wrapper 経由 で リトライ 付き 送信。
  const result = await sendResendEmail(
    { from, to: [args.toEmail], subject, html, text },
    { label: "email.client-invitation" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

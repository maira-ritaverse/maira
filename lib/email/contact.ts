/**
 * 問い合わせフォーム通知メール送信(Resend)
 *
 * LP(/) の問い合わせフォーム送信時に、運営宛てへ通知メールを送る。
 *
 * 方針:
 * - SDK は入れず HTTP API を直接叩く(lib/email/invitation.ts と同じ方式。依存追加を避ける)。
 * - 本文はプレーンテキストのみ。HTML メールにすると、ユーザー入力を埋め込む際に
 *   エスケープ漏れで XSS/インジェクションが発生し得るため、プレーンテキストで根本回避。
 * - 環境変数(RESEND_API_KEY / CONTACT_NOTIFICATION_TO / CONTACT_NOTIFICATION_FROM)が
 *   未設定なら送信せず "not_configured" を返す。呼び出し側で 500 を返す前提。
 * - reply_to に問い合わせ者のメールアドレスを入れて、運営が直接返信できるようにする。
 */

import { sendResendEmail } from "@/lib/email/resend-client";

export type SendContactNotificationResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendContactNotificationArgs = {
  company: string;
  name: string;
  email: string;
  message: string;
};

export async function sendContactNotificationEmail(
  args: SendContactNotificationArgs,
): Promise<SendContactNotificationResult> {
  const to = process.env.CONTACT_NOTIFICATION_TO;
  const from = process.env.CONTACT_NOTIFICATION_FROM;
  if (!to || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = `【Myaira】お問い合わせ:${args.company} ${args.name}`;

  // プレーンテキスト本文。ユーザー入力 は そのまま 埋め込んで OK
  // (HTML と して 解釈 されない ので XSS の リスク なし)。
  const text =
    `Myaira LP の問い合わせフォームから新しい問い合わせが届きました。\n` +
    `\n` +
    `---\n` +
    `会社名:${args.company}\n` +
    `お名前:${args.name}\n` +
    `メール:${args.email}\n` +
    `---\n` +
    `お問い合わせ内容:\n` +
    `${args.message}\n` +
    `---\n` +
    `\n` +
    `この通知メールに返信すると、問い合わせ者(${args.email})宛てに直接返信されます。\n`;

  // C2-1 修正: 直接 fetch を 書いて い た の を Resend wrapper 経由 に 変更。
  // 5xx / 429 / ネットワーク 一時 障害 で 自動 リトライ (指数 バック オフ 3 回)。
  const result = await sendResendEmail(
    {
      from,
      to: [to],
      subject,
      text,
      // 運営 が 「返信」 する だけ で 問い合わせ 者 に メール が 届く よう に する。
      reply_to: [args.email],
    },
    { label: "email.contact" },
  );

  if (result.sent) {
    return { sent: true, messageId: result.messageId };
  }
  if (result.reason === "not_configured") {
    return { sent: false, reason: "not_configured" };
  }
  return { sent: false, reason: "send_failed", error: result.error };
}

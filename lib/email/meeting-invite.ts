/**
 * 面談招待メール送信(Resend、.ics 添付)
 *
 * 求職者宛にメールを送る:
 *   ・件名:面談予定のご案内([タイトル])
 *   ・本文:HTML(ボタン UI)+ プレーンテキスト両方
 *   ・添付:invite.ics(application/calendar)
 *     ※ Resend は attachments[].content に base64 を載せる仕様
 *
 * 設計判断:
 *   ・SDK は使わず HTTP API 直叩き(既存パターンに合わせる)
 *   ・添付 .ics は呼び出し側で buildIcsEvent() で組み立てて渡す
 *   ・暗号化された agenda はメールには載せない(求職者向けには title 中心)
 */
import { sendResendEmail } from "@/lib/email/resend-client";

import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendMeetingInviteResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendMeetingInviteArgs = {
  toEmail: string;
  toName?: string;
  organizationName: string;
  advisorName: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  joinUrl: string;
  passcode?: string | null;
  /** RFC 5545 形式の本文(lib/calendar/ics.buildIcsEvent の戻り値) */
  icsContent: string;
  /** 「キャンセル通知」「リマインダー」など、件名 prefix を切り替える用途 */
  variant?: "invite" | "reminder_24h" | "reminder_1h" | "cancel";
};

function formatJst(d: Date): string {
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
}

function subjectFor(variant: SendMeetingInviteArgs["variant"], title: string): string {
  switch (variant) {
    case "reminder_24h":
      return `【明日】${title} のご予定`;
    case "reminder_1h":
      return `【まもなく】${title} (1時間後)`;
    case "cancel":
      return `【キャンセル】${title} の予定`;
    default:
      return `面談予定のご案内:${title}`;
  }
}

function buildHtml(args: SendMeetingInviteArgs): string {
  const name = args.toName ? `${args.toName} 様` : "ご担当者様";
  const start = formatJst(args.startsAt);
  const end = formatJst(args.endsAt);
  const isCancel = args.variant === "cancel";
  const isReminder = args.variant === "reminder_24h" || args.variant === "reminder_1h";

  const headline = isCancel
    ? "面談予定がキャンセルになりました"
    : args.variant === "reminder_1h"
      ? "まもなく面談が始まります(1 時間後)"
      : args.variant === "reminder_24h"
        ? "明日の面談予定のお知らせ"
        : "面談予定のご案内";

  const intro = isCancel
    ? "以下の面談予定がキャンセルされました。お時間を確保いただいていた場合はご了承ください。"
    : isReminder
      ? "本メールはリマインダーです。下記の予定をご確認ください。"
      : `${escapeHtml(args.organizationName)} の ${escapeHtml(args.advisorName)} です。面談のご予定をお送りいたします。`;

  const infoRows = [infoRow("内容", args.title), infoRow("日時", `${start} 〜 ${end}`)];
  if (args.passcode) {
    infoRows.push(infoRow("パスコード", args.passcode));
  }

  const joinBlock = isCancel
    ? ""
    : `<div style="margin:20px 0;text-align:center;">
  ${primaryButton(args.joinUrl, "会議に参加する")}
  <p style="margin:8px 0 0;font-size:12px;color:#888;word-break:break-all;">${escapeHtml(args.joinUrl)}</p>
</div>`;

  const icsBlock = isCancel
    ? ""
    : `<p style="margin:16px 0 0;font-size:13px;color:#555;line-height:1.6;">
  添付の <code>invite.ics</code> ファイルから、Google Calendar / iOS カレンダー / Outlook 等にこの予定を追加できます。
</p>`;

  const body = `
<h2 style="margin:0 0 8px;font-size:20px;line-height:1.4;">${escapeHtml(headline)}</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(name)}<br>
  ${intro}
</p>

${infoCard(infoRows.join(""))}

${joinBlock}
${icsBlock}

<p style="margin:24px 0 0;font-size:13px;color:#555;line-height:1.6;">
  ${escapeHtml(args.advisorName)}<br>
  <span style="color:#888;">${escapeHtml(args.organizationName)}</span>
</p>
`.trim();

  return renderEmailLayout({
    previewTitle: subjectFor(args.variant ?? "invite", args.title),
    bodyHtml: body,
  });
}

function buildBody(args: SendMeetingInviteArgs): string {
  const name = args.toName ? `${args.toName} 様` : "ご担当者様";
  const start = formatJst(args.startsAt);
  const end = formatJst(args.endsAt);
  const isCancel = args.variant === "cancel";
  const isReminder = args.variant === "reminder_24h" || args.variant === "reminder_1h";

  const header = isCancel
    ? "以下の面談予定がキャンセルになりました。"
    : isReminder
      ? "本メールはリマインダーです。下記の予定をご確認ください。"
      : `${args.organizationName} の ${args.advisorName} です。\n面談のご予定をお送りいたします。`;

  const lines = [
    `${name}`,
    "",
    header,
    "",
    `■ 内容:${args.title}`,
    `■ 日時:${start} 〜 ${end}`,
    `■ 参加 URL:${args.joinUrl}`,
  ];
  if (args.passcode) {
    lines.push(`■ パスコード:${args.passcode}`);
  }
  lines.push("");
  if (!isCancel) {
    lines.push(
      "添付の .ics ファイルから、Google Calendar / iOS カレンダー / Outlook 等に予定を追加できます。",
    );
    lines.push("");
  }
  lines.push(`${args.advisorName}`);
  lines.push(`${args.organizationName}`);
  lines.push("");
  lines.push("──────────────");
  lines.push("このメールは Maira から自動送信されています。");

  return lines.join("\n");
}

export async function sendMeetingInviteEmail(
  args: SendMeetingInviteArgs,
): Promise<SendMeetingInviteResult> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = subjectFor(args.variant ?? "invite", args.title);
  const text = buildBody(args);
  const html = buildHtml(args);

  // .ics は base64 で attach。 Resend は filename + content (base64) 形式。
  const icsBase64 = Buffer.from(args.icsContent, "utf-8").toString("base64");
  const filename = args.variant === "cancel" ? "cancel.ics" : "invite.ics";

  // C2-1: Resend wrapper 経由 で リトライ 付き 送信。
  const result = await sendResendEmail(
    {
      from,
      to: [args.toEmail],
      subject,
      html,
      text,
      attachments: [
        {
          filename,
          content: icsBase64,
          content_type: "text/calendar; charset=utf-8; method=PUBLISH",
        },
      ],
    },
    { label: "email.meeting-invite" },
  );
  if (result.sent) return { sent: true, messageId: result.messageId };
  if (result.reason === "not_configured") return { sent: false, reason: "not_configured" };
  return { sent: false, reason: "send_failed", error: result.error };
}

// テスト容易性のため subject/body 構築だけ export しておく
export const _internal = { subjectFor, buildBody };

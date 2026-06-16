/**
 * 面談招待メール送信(Resend、.ics 添付)
 *
 * 求職者宛にメールを送る:
 *   ・件名:面談予定のご案内([タイトル])
 *   ・本文:日時 / URL / パスコード / 主催者
 *   ・添付:invite.ics(application/calendar)
 *     ※ Resend は attachments[].content に base64 を載せる仕様
 *
 * 設計判断:
 *   ・SDK は使わず HTTP API 直叩き(既存パターンに合わせる)
 *   ・添付 .ics は呼び出し側で buildIcsEvent() で組み立てて渡す
 *   ・暗号化された agenda はメールには載せない(求職者向けには title 中心)
 */

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
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: false, reason: "not_configured" };
  }

  const subject = subjectFor(args.variant ?? "invite", args.title);
  const text = buildBody(args);

  // .ics は base64 で attach。Resend は filename + content(base64) 形式。
  const icsBase64 = Buffer.from(args.icsContent, "utf-8").toString("base64");
  const filename = args.variant === "cancel" ? "cancel.ics" : "invite.ics";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.toEmail],
        subject,
        text,
        attachments: [
          {
            filename,
            content: icsBase64,
            content_type: "text/calendar; charset=utf-8; method=PUBLISH",
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: "send_failed", error: `HTTP ${res.status}: ${body}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, messageId: data.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// テスト容易性のため subject/body 構築だけ export しておく
export const _internal = { subjectFor, buildBody };

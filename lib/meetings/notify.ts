/**
 * 面談予約に対する「メール + in-app + Slack」発火サービス
 *
 * 設計判断:
 *   - 各チャンネル発火失敗は他チャンネルを止めない(try / catch で各々握る)
 *   - 全体結果は呼び出し側に返す(UI でログ可視化したいケースに備える)
 *   - 暗号化された agenda はどのチャンネルにも載せない(host 用 UI のみ復号)
 *   - service_role が必要な処理(in-app 通知 = notifications INSERT)が含まれる
 *     ので サーバ専用
 */
import { buildIcsEvent } from "@/lib/calendar/ics";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { sendMeetingInviteEmail } from "@/lib/email/meeting-invite";
import { fireInAppNotification, fireSeekerNotification } from "@/lib/notifications/in-app";
import { sendSlackMessage } from "@/lib/slack/notify";
import { createServiceClient } from "@/lib/supabase/service";
import type { MeetingScheduleView } from "@/lib/meetings/types";

export type MeetingNotifyResult = {
  emailSent: boolean;
  emailError?: string;
  inAppFired: boolean;
  slackFired: boolean;
};

export type MeetingNotifyContext = {
  meeting: MeetingScheduleView;
  /** ホスト(エージェント)の user_id。組織通知で host 自身を除外する */
  hostUserId: string;
  /** ホスト(エージェント)の表示名 */
  hostDisplayName: string;
  organizationId: string;
  organizationName: string;
  /** 求職者の表示名(client_records.name) */
  inviteeName: string;
  /** 求職者のメール(client_records.email)*/
  inviteeEmail: string | null;
  /** Maira 登録済求職者の場合 user_id を渡すと in-app 通知も発火 */
  seekerUserId: string | null;
  /** "invite" or "reminder_24h" / "reminder_1h" / "cancel" */
  variant: "invite" | "reminder_24h" | "reminder_1h" | "cancel";
};

/**
 * 主たる発火関数。
 *
 * チャンネル別の動作:
 *   ・メール:invitee_email があれば Resend で送信(.ics 添付)
 *   ・in-app(求職者):seekerUserId があれば 1 件 INSERT
 *   ・in-app(組織側):host 以外のメンバ全員に共有(キャンセル時は出さない選択肢もあり)
 *   ・Slack:組織 webhook が設定されていれば 1 件投稿
 */
export async function notifyMeetingScheduled(
  ctx: MeetingNotifyContext,
): Promise<MeetingNotifyResult> {
  const result: MeetingNotifyResult = {
    emailSent: false,
    inAppFired: false,
    slackFired: false,
  };

  const meetingHref = buildAbsoluteUrl(`/agency/clients/${ctx.meeting.clientRecordId ?? ""}`);
  const seekerHref = buildAbsoluteUrl(`/app/dashboard`); // Phase 2.4 で「予定セクション」へ
  const startsLabel = new Date(ctx.meeting.startsAt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // ─── 1) メール送信(招待 / リマインダー / キャンセル)───────────────
  if (ctx.inviteeEmail) {
    try {
      const ics = buildIcsEvent({
        uid: `${ctx.meeting.id}@maira.pro`,
        summary: ctx.meeting.title,
        description:
          ctx.variant === "cancel"
            ? "下記の面談はキャンセルされました。"
            : `${ctx.organizationName} の ${ctx.hostDisplayName} との面談。\n参加 URL: ${ctx.meeting.joinUrl}`,
        location: ctx.meeting.joinUrl,
        startsAt: ctx.meeting.startsAt,
        endsAt: ctx.meeting.endsAt,
        organizerEmail: process.env.EMAIL_FROM ?? undefined,
        organizerName: ctx.hostDisplayName,
        attendees: [{ email: ctx.inviteeEmail, name: ctx.inviteeName }],
        method: ctx.variant === "cancel" ? "CANCEL" : "PUBLISH",
        // キャンセル / 更新で sequence を進める(将来 reschedule 対応時に拡張)
        sequence: ctx.variant === "cancel" ? 1 : 0,
      });
      const sendRes = await sendMeetingInviteEmail({
        toEmail: ctx.inviteeEmail,
        toName: ctx.inviteeName,
        organizationName: ctx.organizationName,
        advisorName: ctx.hostDisplayName,
        title: ctx.meeting.title,
        startsAt: new Date(ctx.meeting.startsAt),
        endsAt: new Date(ctx.meeting.endsAt),
        joinUrl: ctx.meeting.joinUrl,
        passcode: ctx.meeting.passcode,
        icsContent: ics,
        variant: ctx.variant,
      });
      result.emailSent = sendRes.sent;
      if (!sendRes.sent) {
        result.emailError = sendRes.reason === "send_failed" ? sendRes.error : sendRes.reason;
      }
    } catch (err) {
      result.emailError = err instanceof Error ? err.message : "unknown";
    }
  }

  // ─── 2) in-app 通知 ──────────────────────────────────────────────
  try {
    if (ctx.seekerUserId) {
      // 求職者本人にだけ送る通知(リマインダー / キャンセル含めて常に届ける)
      const payload =
        ctx.variant === "cancel"
          ? {
              kind: "meeting_canceled" as const,
              title: `面談キャンセル: ${ctx.meeting.title}`,
              href: seekerHref,
              meetingScheduleId: ctx.meeting.id,
              meetingTitle: ctx.meeting.title,
              startsAtIso: ctx.meeting.startsAt,
            }
          : ctx.variant === "reminder_24h" || ctx.variant === "reminder_1h"
            ? {
                kind: "meeting_reminder" as const,
                title: `面談リマインダー(${ctx.variant === "reminder_24h" ? "24時間前" : "1時間前"}): ${ctx.meeting.title}`,
                href: seekerHref,
                meetingScheduleId: ctx.meeting.id,
                meetingTitle: ctx.meeting.title,
                startsAtIso: ctx.meeting.startsAt,
                joinUrl: ctx.meeting.joinUrl,
                window: ctx.variant === "reminder_24h" ? ("24h" as const) : ("1h" as const),
              }
            : {
                kind: "meeting_invited" as const,
                title: `面談予約: ${ctx.meeting.title}(${startsLabel})`,
                href: seekerHref,
                meetingScheduleId: ctx.meeting.id,
                meetingTitle: ctx.meeting.title,
                startsAtIso: ctx.meeting.startsAt,
                joinUrl: ctx.meeting.joinUrl,
                organizationName: ctx.organizationName,
              };
      await fireSeekerNotification({ userId: ctx.seekerUserId, payload });
    }

    // 組織側(host 以外)にも共有(招待 / キャンセル時のみ。リマインダーは host 以外への
    // ノイズになるので出さない)
    if (ctx.variant === "invite" || ctx.variant === "cancel") {
      const orgPayload =
        ctx.variant === "cancel"
          ? {
              kind: "meeting_canceled" as const,
              title: `面談キャンセル: ${ctx.inviteeName} (${ctx.meeting.title})`,
              href: meetingHref,
              meetingScheduleId: ctx.meeting.id,
              meetingTitle: ctx.meeting.title,
              startsAtIso: ctx.meeting.startsAt,
            }
          : {
              kind: "meeting_invited" as const,
              title: `面談予約: ${ctx.inviteeName} (${startsLabel})`,
              href: meetingHref,
              meetingScheduleId: ctx.meeting.id,
              meetingTitle: ctx.meeting.title,
              startsAtIso: ctx.meeting.startsAt,
              joinUrl: ctx.meeting.joinUrl,
              organizationName: ctx.organizationName,
            };
      await fireInAppNotification({
        organizationId: ctx.organizationId,
        excludeUserId: ctx.hostUserId,
        payload: orgPayload,
      });
    }
    result.inAppFired = true;
  } catch {
    // 通知失敗は無視(運用ログのみ)
  }

  // ─── 3) Slack 通知 ──────────────────────────────────────────────
  try {
    const service = createServiceClient();
    const { data: org } = await service
      .from("organizations")
      .select("slack_webhook_url")
      .eq("id", ctx.organizationId)
      .maybeSingle();
    const webhookUrl =
      (org as { slack_webhook_url: string | null } | null)?.slack_webhook_url ?? null;
    if (webhookUrl) {
      const head =
        ctx.variant === "cancel"
          ? `:warning: 面談キャンセル`
          : ctx.variant === "reminder_24h"
            ? `:alarm_clock: 24時間後の面談リマインダー`
            : ctx.variant === "reminder_1h"
              ? `:alarm_clock: 1時間後の面談`
              : `:calendar: 面談予約`;
      const text = `${head}: ${ctx.inviteeName} / ${ctx.meeting.title}\n${startsLabel}\n${ctx.meeting.joinUrl}`;
      const r = await sendSlackMessage({ webhookUrl, text });
      result.slackFired = r.sent;
    }
  } catch {
    // Slack 失敗は無視
  }

  return result;
}

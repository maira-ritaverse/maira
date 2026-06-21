/**
 * LINE 新着 メッセージ 通知 fan-out (in-app + Slack + メール)
 *
 * 仕様 (Q6: D):
 *   ・in-app:同 org の メンバー 全員 に 通知 (notification_prefs 尊重)
 *   ・Slack:organizations.slack_webhook_url が あれば 送信
 *   ・メール:admin 全員 に 送信
 *
 * 失敗 は 各 チャンネル 独立 try-catch (片方 失敗 で 他方 を 止めない)。
 *
 * 呼出 元:webhook event-handler の handleMessage 成功時。
 * トリガー しないケース:system イベント (follow/unfollow) は 通知 不要。
 */
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { sendLineMessageEmail } from "@/lib/email/line-message-received";
import { isEmailEnabled, isSubscribed, type NotificationPrefs } from "@/lib/notifications/prefs";
import { fireInAppNotification } from "@/lib/notifications/in-app";
import { sendSlackMessage } from "@/lib/slack/notify";
import { createServiceClient } from "@/lib/supabase/service";

export type NotifyLineMessageArgs = {
  organizationId: string;
  lineUserId: string;
  /** LINE プロフィール 名 */
  senderDisplayName: string | null;
  /** 紐付け 済 client_record の 名前 (任意) */
  clientName: string | null;
  /** 復号 済 プレビュー (短縮) */
  preview: string;
  messageType: string;
};

export async function notifyAgencyOfLineMessage(args: NotifyLineMessageArgs): Promise<void> {
  const service = createServiceClient();
  const senderLabel = args.clientName ?? args.senderDisplayName ?? "(名前なし)";
  const title = `${senderLabel} さん から LINE 新着`;
  const href = `/agency/line/${encodeURIComponent(args.lineUserId)}`;

  await Promise.all([
    fireInAppSafe(args, title, href),
    fireSlackSafe(service, args, senderLabel),
    fireEmailsSafe(service, args, senderLabel, href),
  ]);
}

async function fireInAppSafe(
  args: NotifyLineMessageArgs,
  title: string,
  href: string,
): Promise<void> {
  try {
    await fireInAppNotification({
      organizationId: args.organizationId,
      excludeUserId: "", // 求職者 操作 ではない ので 除外 user なし
      payload: {
        kind: "line_message_received",
        title,
        href,
        lineUserId: args.lineUserId,
        senderDisplayName: args.senderDisplayName,
        clientName: args.clientName,
        preview: args.preview,
        messageType: args.messageType,
      },
    });
  } catch (err) {
    console.warn("[line/notify/in-app] failed", err);
  }
}

async function fireSlackSafe(
  service: ReturnType<typeof createServiceClient>,
  args: NotifyLineMessageArgs,
  senderLabel: string,
): Promise<void> {
  try {
    const { data: orgRow } = await service
      .from("organizations")
      .select("slack_webhook_url")
      .eq("id", args.organizationId)
      .maybeSingle();
    const slackUrl =
      (orgRow as { slack_webhook_url: string | null } | null)?.slack_webhook_url ?? null;
    if (!slackUrl) return;

    const text = `:speech_balloon: *${senderLabel}* さん から LINE 新着 (${args.messageType})\n> ${args.preview}\n${buildAbsoluteUrl(`/agency/line/${encodeURIComponent(args.lineUserId)}`)}`;
    const result = await sendSlackMessage({ webhookUrl: slackUrl, text });
    if (!result.sent && result.reason === "failed") {
      console.warn("[line/notify/slack] failed:", result.error);
    }
  } catch (err) {
    console.warn("[line/notify/slack] threw", err);
  }
}

async function fireEmailsSafe(
  service: ReturnType<typeof createServiceClient>,
  args: NotifyLineMessageArgs,
  senderLabel: string,
  href: string,
): Promise<void> {
  try {
    // admin 全員 を user_id + notification_prefs で 取得 し、 メール 全体 OFF と
    // line_message_received の OFF を 両方 尊重 して 送信 対象 を フィルタ。
    const { data: admins } = await service
      .from("organization_members")
      .select("user_id, notification_prefs")
      .eq("organization_id", args.organizationId)
      .eq("role", "admin");

    type Row = { user_id: string; notification_prefs: NotificationPrefs | null };
    const eligible = ((admins ?? []) as Row[]).filter(
      (m) =>
        isEmailEnabled(m.notification_prefs) &&
        isSubscribed(m.notification_prefs, "line_message_received"),
    );
    if (eligible.length === 0) return;

    const lookups = await Promise.all(
      eligible.map((m) => service.auth.admin.getUserById(m.user_id)),
    );
    const emails = lookups
      .map((r) => r.data?.user?.email ?? null)
      .filter((e): e is string => typeof e === "string" && e.length > 0);

    const { data: orgRow } = await service
      .from("organizations")
      .select("name")
      .eq("id", args.organizationId)
      .maybeSingle();
    const organizationName = (orgRow as { name?: string } | null)?.name ?? "(エージェント企業)";

    await Promise.all(
      emails.map((to) =>
        sendLineMessageEmail({
          toEmail: to,
          organizationName,
          senderLabel,
          preview: args.preview,
          conversationUrl: buildAbsoluteUrl(href),
        }).then((r) => {
          if (!r.sent && r.reason === "send_failed") {
            console.warn("[line/notify/email] failed", { to, error: r.error });
          }
        }),
      ),
    );
  } catch (err) {
    console.warn("[line/notify/email] threw", err);
  }
}

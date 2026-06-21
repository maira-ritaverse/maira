/**
 * 求職者アクション(興味あり / 応募を依頼)→ エージェント側 3 チャンネル通知の共通ヘルパ
 *
 * /api/me/job-recommendations/[jobId]/interest と /apply の両方で
 * 同じ「in-app + Slack + メール」発火パターンを書いていたのを集約する。
 *
 * 設計判断:
 *   - 通知の失敗は呼び出し側のレスポンスに影響させない(本処理は既に成功している前提)
 *   - 各チャンネルは独立して try-catch(片方の失敗が他方を止めない)
 *   - service_role を使うため呼び出し側の境界を越える。kind / clientRecordId 等は
 *     呼び出し側で「本人の操作 + 自分の linked 関係」を確認済みの状態で渡す責任を持つ
 */
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { sendSeekerActionEmail } from "@/lib/email/seeker-action";
import { fireInAppNotification } from "@/lib/notifications/in-app";
import { isEmailEnabled, isSubscribed, type NotificationPrefs } from "@/lib/notifications/prefs";
import { sendSlackMessage } from "@/lib/slack/notify";
import { createServiceClient } from "@/lib/supabase/service";

export type SeekerActionKind = "seeker_job_interest" | "seeker_application_request";

export type NotifyAgencyArgs = {
  jobId: string;
  /** 発火者(求職者本人)の user.id。in-app の exclude にも使う */
  userId: string;
  /** 表示名フォールバック用 */
  userEmail: string | null;
  /** 紐づく client_record(無ければ null)。href + clientName 解決に使う */
  clientRecordId: string | null;
  actionKind: SeekerActionKind;
  /** UI 表示用("興味あり" or "応募を依頼") */
  actionLabel: string;
};

/**
 * エージェント側に求職者アクションを通知する(in-app + Slack + メール)。
 * 通知失敗はログ出力のみで握り潰す(発火元は既に成功レスポンスを返している前提)。
 */
export async function notifyAgencyOfSeekerAction(args: NotifyAgencyArgs): Promise<void> {
  const service = createServiceClient();

  // 求人 + 組織情報を取得
  const { data: jobRow } = await service
    .from("job_postings")
    .select("id, organization_id, company_name, position, organizations(name)")
    .eq("id", args.jobId)
    .maybeSingle();
  if (!jobRow) return;
  const job = jobRow as {
    id: string;
    organization_id: string;
    company_name: string;
    position: string;
    organizations: { name: string } | { name: string }[] | null;
  };
  const orgName = Array.isArray(job.organizations)
    ? (job.organizations[0]?.name ?? "Maira")
    : (job.organizations?.name ?? "Maira");

  // 求職者の表示名(client_records.name 優先、無ければ email ローカル部)
  let clientName = "求職者";
  if (args.clientRecordId) {
    const { data: cr } = await service
      .from("client_records")
      .select("name")
      .eq("id", args.clientRecordId)
      .maybeSingle();
    if (cr?.name) clientName = cr.name as string;
  }
  if (clientName === "求職者" && args.userEmail) {
    clientName = args.userEmail.split("@")[0];
  }

  const jobLabel = `${job.company_name} ・ ${job.position}`;
  const href = args.clientRecordId
    ? `/agency/clients/${args.clientRecordId}`
    : `/agency/jobs/${job.id}`;
  const title = buildTitle(args.actionKind, clientName, jobLabel);

  // 各チャンネルを独立 try-catch で発火
  await Promise.all([
    fireInAppSafe(job.organization_id, args, title, href, jobLabel, clientName),
    fireSlackSafe(service, job.organization_id, args, clientName, jobLabel),
    fireEmailsSafe(service, job.organization_id, orgName, clientName, jobLabel, args, href),
  ]);
}

function buildTitle(kind: SeekerActionKind, clientName: string, jobLabel: string): string {
  return kind === "seeker_job_interest"
    ? `${clientName} さんが「${jobLabel}」に興味あり`
    : `${clientName} さんが「${jobLabel}」への応募を依頼`;
}

async function fireInAppSafe(
  organizationId: string,
  args: NotifyAgencyArgs,
  title: string,
  href: string,
  jobLabel: string,
  clientName: string,
): Promise<void> {
  try {
    // fireInAppNotification は内部で createServiceClient() を呼ぶので service は不要
    await fireInAppNotification({
      organizationId,
      excludeUserId: args.userId,
      payload: {
        kind: args.actionKind,
        title,
        href,
        clientRecordId: args.clientRecordId ?? "",
        clientName,
        jobPostingId: args.jobId,
        jobLabel,
      },
    });
  } catch (err) {
    console.warn("[seeker-action/in-app] failed", err);
  }
}

async function fireSlackSafe(
  service: ReturnType<typeof createServiceClient>,
  organizationId: string,
  args: NotifyAgencyArgs,
  clientName: string,
  jobLabel: string,
): Promise<void> {
  try {
    const { data: orgSlack } = await service
      .from("organizations")
      .select("slack_webhook_url")
      .eq("id", organizationId)
      .maybeSingle();
    const slackUrl =
      (orgSlack as { slack_webhook_url: string | null } | null)?.slack_webhook_url ?? null;
    if (!slackUrl) return;
    const emoji =
      args.actionKind === "seeker_application_request" ? ":mailbox_with_mail:" : ":raising_hand:";
    const text = `${emoji} *${clientName}* さんが *${jobLabel}* に「${args.actionLabel}」`;
    const result = await sendSlackMessage({ webhookUrl: slackUrl, text });
    if (!result.sent && result.reason === "failed") {
      console.warn("[seeker-action/slack] failed:", result.error);
    }
  } catch (err) {
    console.warn("[seeker-action/slack] threw", err);
  }
}

async function fireEmailsSafe(
  service: ReturnType<typeof createServiceClient>,
  organizationId: string,
  orgName: string,
  clientName: string,
  jobLabel: string,
  args: NotifyAgencyArgs,
  href: string,
): Promise<void> {
  try {
    // admin の メール 通知 全体 設定 + 該当 通知 種類 の 個別 設定 を 両方 尊重 し
    // 送信 対象 を フィルタ する。
    const { data: admins } = await service
      .from("organization_members")
      .select("user_id, notification_prefs")
      .eq("organization_id", organizationId)
      .eq("role", "admin");
    type Row = { user_id: string; notification_prefs: NotificationPrefs | null };
    const eligible = ((admins ?? []) as Row[]).filter(
      (m) =>
        isEmailEnabled(m.notification_prefs) && isSubscribed(m.notification_prefs, args.actionKind),
    );
    if (eligible.length === 0) return;

    // admin user email を並列取得(supabase-js は内部で接続を多重化するため安全)
    const lookups = await Promise.all(
      eligible.map((m) => service.auth.admin.getUserById(m.user_id)),
    );
    const emails = lookups
      .map((r) => r.data?.user?.email ?? null)
      .filter((e): e is string => typeof e === "string" && e.length > 0);
    await Promise.all(
      emails.map((to) =>
        sendSeekerActionEmail({
          toEmail: to,
          organizationName: orgName,
          clientName,
          jobLabel,
          actionLabel: args.actionLabel,
          href: buildAbsoluteUrl(href),
        }).then((r) => {
          if (!r.sent && r.reason === "send_failed") {
            console.warn("[seeker-action/email] failed", { to, error: r.error });
          }
        }),
      ),
    );
  } catch (err) {
    console.warn("[seeker-action/email] threw", err);
  }
}

/**
 * タイトル生成は pure なのでテスト可能(プライバシー文言の回帰防止用)。
 */
export const _internal = { buildTitle };

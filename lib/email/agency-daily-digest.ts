/**
 * Daily ダイジェスト メール (Phase A1: プロアクティブ 伴走)
 *
 * 送信 タイミング: 毎朝 JST 8:00 (= UTC 23:00) の cron。
 * 対象:   organization の admin で email_enabled かつ daily_digest が ON。
 * 内容:   今日 / 期限超過 の タスク 件数、 沈黙 顧客 数、 進捗 停止 中 応募 数。
 *         全 件数 が 0 の 場合 は そもそも 呼出 側 で skip (本 関数 は 呼ばれない)。
 *
 * UX 方針:
 *   ・件名 に 「数字」 を 含めて 開封 動機 を 作る
 *   ・本文 は 短く、 詳細 は ダッシュボード で 見せる (= リンク 一本)
 *   ・「平和な 朝」 (全 0) は 送らない (= 数 ヶ月 後 に 開封 率 を 守る ため)
 */
import type { DailyDigestSummary } from "@/lib/agency/daily-digest";
import { escapeHtml, infoCard, infoRow, primaryButton, renderEmailLayout } from "./layout";

export type SendDailyDigestResult =
  | { sent: true; messageId: string | null }
  | { sent: false; reason: "not_configured" | "send_failed"; error?: string };

export type SendDailyDigestArgs = {
  toEmail: string;
  organizationName: string;
  /** メンバー の 表示 名 (= 件名 の パーソナライズ 用) */
  memberDisplayName: string | null;
  summary: DailyDigestSummary;
  /** /agency ダッシュボード への フル URL */
  dashboardUrl: string;
  /** 今日 の 日付 ラベル (例: 「2026/06/30 (月)」) */
  todayLabel: string;
};

export async function sendDailyDigestEmail(
  args: SendDailyDigestArgs,
): Promise<SendDailyDigestResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  const { summary, memberDisplayName, organizationName, todayLabel } = args;
  const subjectParts: string[] = [];
  if (summary.todayTaskCount > 0) subjectParts.push(`今日 ${summary.todayTaskCount} 件`);
  if (summary.overdueTaskCount > 0) subjectParts.push(`超過 ${summary.overdueTaskCount} 件`);
  if (summary.silentClientCount > 0) subjectParts.push(`沈黙 ${summary.silentClientCount} 件`);
  if (summary.stalledReferralCount > 0)
    subjectParts.push(`停止 ${summary.stalledReferralCount} 件`);
  const headline = subjectParts.length > 0 ? subjectParts.join(" / ") : "本日 の 注意 事項";
  const subject = `【Maira 朝の ダイジェスト】${headline}`;

  const greeting = memberDisplayName ? `${memberDisplayName} 様` : `${organizationName} 様`;

  const text = [
    `${greeting}`,
    ``,
    `${todayLabel} の Maira ダイジェスト です。`,
    ``,
    `■ 自分 宛 の タスク`,
    `  今日 期限: ${summary.todayTaskCount} 件`,
    `  期限 超過: ${summary.overdueTaskCount} 件`,
    ``,
    `■ 組織 全体 の 注意`,
    `  30 日 以上 対応 していない 顧客: ${summary.silentClientCount} 件`,
    `  7 日 以上 進捗 が ない 応募: ${summary.stalledReferralCount} 件`,
    ``,
    `ダッシュボード:`,
    args.dashboardUrl,
    ``,
    `※ 件数 が 全て 0 の 朝 は 本 メール は 配信 されません。`,
    `※ 配信 停止 は Maira → 個人 設定 → 通知設定 で 切替 でき ます。`,
    ``,
    `Maira 運営チーム`,
  ].join("\n");

  const body = `
<h2 style="margin:0 0 12px;font-size:18px;line-height:1.4;">朝の ダイジェスト</h2>
<p style="margin:0 0 16px;color:#555;line-height:1.6;font-size:14px;">
  ${escapeHtml(greeting)}<br>
  <span style="color:#888;font-size:12px;">${escapeHtml(todayLabel)} の 注意 事項 を まとめ ました。</span>
</p>

<h3 style="margin:16px 0 8px;font-size:14px;line-height:1.4;">自分 宛 の タスク</h3>
${infoCard(
  infoRow("今日 期限", `${summary.todayTaskCount} 件`) +
    infoRow("期限 超過", `${summary.overdueTaskCount} 件`),
)}

<h3 style="margin:16px 0 8px;font-size:14px;line-height:1.4;">組織 全体 の 注意</h3>
${infoCard(
  infoRow("30 日 沈黙 顧客", `${summary.silentClientCount} 件`) +
    infoRow("7 日 進捗 停止 応募", `${summary.stalledReferralCount} 件`),
)}

<div style="margin:20px 0 8px;text-align:center;">
  ${primaryButton(args.dashboardUrl, "ダッシュボード を 開く")}
</div>

<p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
  ※ 件数 が 全て 0 の 朝 は 本 メール は 配信 されません。<br>
  ※ 配信 停止 は Maira → 個人 設定 → 通知設定 で 切替 でき ます。
</p>
`.trim();

  const html = renderEmailLayout({ previewTitle: subject, bodyHtml: body });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [args.toEmail],
        subject,
        text,
        html,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { sent: false, reason: "send_failed", error: errorText };
    }
    const json = (await response.json()) as { id?: string };
    return { sent: true, messageId: json.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "send_failed",
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

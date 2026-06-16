/**
 * Slack 通知(Incoming Webhook)
 *
 * 組織ごとに organizations.slack_webhook_url を 1 つ持って、重要イベントを通知する。
 * 失敗は呼び出し側に握ってもらう前提でエラーを投げず、結果型で返す。
 *
 * セキュリティ:
 *   - Webhook URL を console.log で出力しない(URL 自体が認証情報)。
 *   - 既定のテキストには PII(個人情報)を含めるが、機密の暗号化フィールド(推薦コメント、
 *     学歴詳細、面談所感等)は呼び出し側で渡さないこと。
 */

export type SendSlackResult =
  | { sent: true }
  | { sent: false; reason: "no_url" | "failed"; error?: string };

export type SendSlackArgs = {
  /** organizations.slack_webhook_url の値。null / 空文字なら no-op で返す。 */
  webhookUrl: string | null;
  /** Slack の主表示テキスト(改行可) */
  text: string;
};

export async function sendSlackMessage(args: SendSlackArgs): Promise<SendSlackResult> {
  if (!args.webhookUrl || args.webhookUrl.trim() === "") {
    return { sent: false, reason: "no_url" };
  }

  try {
    const res = await fetch(args.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: args.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: "failed", error: `HTTP ${res.status}: ${body}` };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Slack 通知の URL を組織から取得する helper。
 * 取得失敗時は null。
 */
import { createClient } from "@/lib/supabase/server";
export async function getOrganizationSlackWebhookUrl(
  organizationId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("slack_webhook_url")
    .eq("id", organizationId)
    .maybeSingle();
  if (!data) return null;
  return (data as { slack_webhook_url: string | null }).slack_webhook_url ?? null;
}

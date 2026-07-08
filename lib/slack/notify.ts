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

import { isNetworkError, isRetryableStatus, withRetry } from "@/lib/retry/with-retry";

export async function sendSlackMessage(args: SendSlackArgs): Promise<SendSlackResult> {
  if (!args.webhookUrl || args.webhookUrl.trim() === "") {
    return { sent: false, reason: "no_url" };
  }

  // C2-1 修正: 従来 は 1 回 の fetch で 完結 して おり、 Slack Webhook 側 の
  // 一時 障害 (429 / 5xx / 短 時間 の ネットワーク エラー) で 全て 失敗 と なって
  // いた。 指数 バック オフ で 3 回 まで リトライ する。 テキスト メッセージ の
  // 冪等 性 は 「同 内容 が 二 度 届く 可能性 が ある」 程度 で 実害 が 小さい ため
  // OK と 判断。 リトライ 判定 は HTTP 429 / 5xx / ネットワーク エラー のみ。
  const result = await withRetry<null>(
    async () => {
      try {
        const res = await fetch(args.webhookUrl!, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: args.text }),
        });
        if (res.ok) return { retry: false, ok: true, value: null };
        const body = await res.text().catch(() => "");
        const message = `HTTP ${res.status}: ${body.slice(0, 200)}`;
        if (isRetryableStatus(res.status)) {
          return { retry: true, reason: "slack_http_retryable", error: message };
        }
        return { retry: false, ok: false, reason: "slack_http_permanent", error: message };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isNetworkError(err)) {
          return { retry: true, reason: "slack_network", error: message };
        }
        return { retry: false, ok: false, reason: "slack_exception", error: message };
      }
    },
    { label: "slack.sendMessage", maxAttempts: 3, initialDelayMs: 200, maxDelayMs: 1200 },
  );

  if (result.ok) return { sent: true };
  return { sent: false, reason: "failed", error: result.error ?? result.reason };
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

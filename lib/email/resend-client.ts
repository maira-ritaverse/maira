/**
 * Resend HTTP API 用 の 共通 送信 クライアント (リトライ 込み)。
 *
 * C2-1 の 中核: 従来 は 13 の email helper が それ ぞれ 独自 に
 * `fetch("https://api.resend.com/emails", ...)` を 書いて おり、 5xx / 429 /
 * ネットワーク 一時 障害 に 対する リトライ が 一切 無かった。 本 helper に 集約
 * して 指数 バック オフ で 3 回 まで 自動 リトライ する。
 *
 * SDK を 導入 しない のは 従来 と 同じ 方針 (バンドル サイズ + Cold start 圧縮)。
 */
import { isNetworkError, isRetryableStatus, withRetry } from "@/lib/retry/with-retry";

export type ResendSendPayload = {
  from: string;
  to: string[];
  subject: string;
  /** text か html の どちら か 必須。 両方 可。 */
  text?: string;
  html?: string;
  reply_to?: string[];
};

export type ResendSendResult =
  | { sent: true; messageId: string | null; attempts: number }
  | {
      sent: false;
      reason: "not_configured" | "send_failed";
      error?: string;
      attempts: number;
    };

export type ResendSendOptions = {
  /** API Key を 明示 指定 (テスト 用)。 通常 は process.env.RESEND_API_KEY を 参照。 */
  apiKey?: string;
  /** リトライ の ラベル。 呼び出し 元 helper 名 を 入れる。 */
  label?: string;
  /** 最大 試行 回数。 デフォルト 3。 */
  maxAttempts?: number;
};

/**
 * Resend の /emails endpoint に POST する。 失敗 は 結果 型 で 返す (throw しない)。
 * 呼び 出し 側 は sent:false の 場合 に fallback / エラー ハンドリング を 行う。
 */
export async function sendResendEmail(
  payload: ResendSendPayload,
  options: ResendSendOptions = {},
): Promise<ResendSendResult> {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return { sent: false, reason: "not_configured", attempts: 0 };
  }

  const result = await withRetry<{ id: string | null }>(
    async () => {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { id?: string };
          return { retry: false, ok: true, value: { id: data.id ?? null } };
        }
        const body = await res.text().catch(() => "");
        const message = `HTTP ${res.status}: ${body.slice(0, 200)}`;
        if (isRetryableStatus(res.status)) {
          return { retry: true, reason: "resend_http_retryable", error: message };
        }
        return { retry: false, ok: false, reason: "resend_http_permanent", error: message };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isNetworkError(err)) {
          return { retry: true, reason: "resend_network", error: message };
        }
        return { retry: false, ok: false, reason: "resend_exception", error: message };
      }
    },
    {
      label: options.label ?? "resend.sendEmail",
      maxAttempts: options.maxAttempts ?? 3,
      initialDelayMs: 300,
      maxDelayMs: 1500,
    },
  );

  if (result.ok) {
    return { sent: true, messageId: result.value.id, attempts: result.attempts };
  }
  return {
    sent: false,
    reason: "send_failed",
    error: result.error ?? result.reason,
    attempts: result.attempts,
  };
}

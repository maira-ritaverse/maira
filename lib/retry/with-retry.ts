/**
 * 冪等 な 外部 呼び出し に 対する 指数 バック オフ リトライ ヘルパー。
 *
 * C2-1 (Batch 2 監査 finding: Resend / Slack retry 未 実装) 対策。
 * Vercel サーバーレス 環境 では job queue を 別途 建てて い ない ため、
 * 呼び 出し ホットパス 内 で in-memory リトライ する。 「暫定 障害」 に 対して
 * 有効 で、 恒常 的 障害 (認証 エラー 等) は 判定 関数 で 早期 中断 する。
 *
 * 前提:
 *   - 呼び 出し は 冪等 な API のみ 対象 (Resend / Slack Webhook / Stripe GET)。
 *   - Vercel Serverless の function 実行 上限 (Hobby 10s, Pro 60s) を 超える
 *     長 リトライ は 避ける。 総 待機 時間 で 3 秒 以内 を 目安 と する。
 *   - 呼び 出し 側 は 結果 型 で 「最終 的 に 成功 した か」 を 判断。
 */

export type RetryableResult<T> =
  | { retry: false; ok: true; value: T }
  | { retry: false; ok: false; reason: string; error?: string }
  | { retry: true; reason: string; error?: string };

export type WithRetryOptions = {
  /** 最大 試行 回数 (初回 含む)。 デフォルト 3。 */
  maxAttempts?: number;
  /** 初回 待機 (ms)。 各 リトライ で 2 倍 に なる。 デフォルト 200ms。 */
  initialDelayMs?: number;
  /** 待機 の 上限 (ms)。 デフォルト 1500ms。 */
  maxDelayMs?: number;
  /** ラベル (ログ 出力 用)。 */
  label?: string;
};

export type FinalResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; reason: string; error?: string; attempts: number };

/**
 * fn が RetryableResult を 返し、 retry:true の 場合 に 指数 バック オフ で 再 試行 する。
 * fn が throw した 場合 は 「予期 せぬ 例外」 として 即 中断 (呼び 出し 側 で 上位 catch)。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<RetryableResult<T>>,
  options: WithRetryOptions = {},
): Promise<FinalResult<T>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 1500;
  const label = options.label ?? "retry";

  let last: RetryableResult<T> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fn(attempt);
    last = result;
    if (!result.retry) {
      if (result.ok) return { ok: true, value: result.value, attempts: attempt };
      return { ok: false, reason: result.reason, error: result.error, attempts: attempt };
    }
    if (attempt >= maxAttempts) break;
    const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
    console.warn(`[${label}] retryable failure attempt=${attempt}`, {
      reason: result.reason,
      error: result.error,
      nextDelayMs: delay,
    });
    await sleep(delay);
  }

  // maxAttempts 到達 or last=null (fn が 呼ば れ なかった 異常 系)
  if (!last || last.retry !== true) {
    return { ok: false, reason: "unknown_failure", attempts: maxAttempts };
  }
  return {
    ok: false,
    reason: last.reason,
    error: last.error,
    attempts: maxAttempts,
  };
}

/**
 * HTTP status を 見て 「リトライ で 回復 可能」 か 判定 する。 呼び 出し 側 で
 * withRetry の fn 内 で 使う。 429 (rate limit) と 5xx は 再 試行、 4xx は 恒常 障害。
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

/**
 * fetch 例外 (ネットワーク 到達 不能 / タイムアウト) は 全て リトライ 対象 と する。
 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name.toLowerCase();
  const msg = err.message.toLowerCase();
  return (
    name.includes("timeout") ||
    name.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Anthropic API の レート 制限 監視 ヘルパー。
 *
 * C2-3 (Batch 2 監査 finding): 従来 は categorizeAIError で 429 を 分類 する
 * だけ で、 「一定 時間 内 に 何 回 429 が 発生 したか」 を 見る 手段 が 無く、
 * バースト 発生 の 兆候 を 事前 に 掴め なかった。
 *
 * 仕組み:
 *   - 429 を 受け たら recordAnthropic429Event() で rate_limit_events テーブル
 *     に 1 行 記録 (namespace="ai_anthropic:429"、 identifier="global")
 *   - getRecentAnthropic429Count(60) で 直近 N 秒 の 発生 数 を 取得
 *   - isAnthropicThrottled() は 直近 60 秒 で 5 件 以上 の 429 が あれば true
 *   - handleAnthropicError() は onError などから 呼ぶ 集約 wrapper
 *     (categorizeAIError + 必要 なら 記録 の 二つ を 1 手 で 処理)
 *
 * 記録 は fire-and-forget (失敗 して も 呼び出し 元 の レスポンス に は 影響 させない)。
 * インフラ は Batch 2 で 導入 済 の rate_limit_events テーブル + consume_rate_limit
 * RPC を 再利用 する (namespace で 分離)。
 */
import { categorizeAIError, type AIErrorInfo } from "@/lib/ai/error-handler";
import { createServiceClient } from "@/lib/supabase/service";

const NAMESPACE = "ai_anthropic:429";
const GLOBAL_IDENTIFIER = "global";
const BUCKET_KEY = `${NAMESPACE}:${GLOBAL_IDENTIFIER}`;

/** 直近 60 秒 で 何 件 の 429 が あった か で throttle 判定。 */
const THROTTLE_WINDOW_SECONDS = 60;
const THROTTLE_THRESHOLD = 5;

/**
 * Anthropic API の 429 発生 を 記録 する。 fire-and-forget。
 * consume_rate_limit RPC は 上限 チェック も 兼ねる が、 ここ で は 記録 用途 で
 * のみ 使う ため p_max_count に 非現実的 な 値 を 渡して 常に true を 返させる。
 */
export async function recordAnthropic429Event(): Promise<void> {
  try {
    const admin = createServiceClient();
    await admin.rpc("consume_rate_limit", {
      p_bucket_key: BUCKET_KEY,
      p_window_seconds: 3600,
      // ここ を 大きく する と 上限 判定 は 常に false (= 記録 のみ) に なる。
      p_max_count: 1_000_000,
    });
  } catch (err) {
    // 監視 用 な の で 失敗 して も 呼び出し 元 の 処理 は 継続。
    console.warn("[ai/rate-limit-monitor] failed to record 429 event", {
      name: err instanceof Error ? err.name : "unknown",
    });
  }
}

/**
 * 直近 window 秒 の 429 発生 回数 を 取得 する (admin 監視 用)。
 */
export async function getRecentAnthropic429Count(
  windowSeconds: number = THROTTLE_WINDOW_SECONDS,
): Promise<number> {
  try {
    const admin = createServiceClient();
    const sinceIso = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { count } = await admin
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("bucket_key", BUCKET_KEY)
      .gte("occurred_at", sinceIso);
    return typeof count === "number" ? count : 0;
  } catch (err) {
    console.warn("[ai/rate-limit-monitor] failed to fetch 429 count", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return 0;
  }
}

/**
 * 直近 のバースト を 検知 する 簡易 チェック。 呼び出し 元 は preemptive に throttle
 * する か 判断 する 材料 として 使う (opt-in)。 現状 は 60 秒 で 5 件 以上。
 */
export async function isAnthropicThrottled(): Promise<boolean> {
  const count = await getRecentAnthropic429Count(THROTTLE_WINDOW_SECONDS);
  return count >= THROTTLE_THRESHOLD;
}

/**
 * AI 呼び出し の 失敗 を 一括 で 分類 + 記録 する ラッパー。
 *
 * 使い方 (streamText の onError や 通常 の try / catch の catch 節 で):
 *   const info = await handleAnthropicError(err);
 *
 * onError などから 呼び出す ケース で fire-and-forget した い 場合 は
 * void handleAnthropicError(err); で 呼び 捨て 可能。
 */
export async function handleAnthropicError(error: unknown): Promise<AIErrorInfo> {
  const info = categorizeAIError(error);
  if (info.category === "rate_limit") {
    await recordAnthropic429Event();
  }
  return info;
}

/**
 * ストリーミング API route の onError 用 の 同期 ヘルパー。
 * 内部 の 429 記録 は fire-and-forget (Promise を 呼び 捨て) で 行い、
 * onError の 契約 (同期 コールバック) を 維持 する。
 *
 * 使い方:
 *   onError: ({ error }) => logAiStreamError(error, "Career chat"),
 */
export function logAiStreamError(error: unknown, prefix: string): AIErrorInfo {
  const info = categorizeAIError(error);
  console.error(`${prefix} streaming error:`, info.category, info.userMessage, error);
  if (info.category === "rate_limit") {
    // fire-and-forget: 監視 記録 は onError の 応答 に 影響 させない
    void recordAnthropic429Event();
  }
  return info;
}

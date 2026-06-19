/**
 * Next.js 15 の instrumentation hook。
 *
 * Sentry SDK v8+ では、ランタイム別に config を 動的 import する 公式 パターン。
 * このファイルが あれば Next.js が 起動時に register() を 呼ぶ。
 *
 * 参照: https://docs.sentry.io/platforms/javascript/guides/nextjs/install/manual-setup/
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Sentry 推奨:Next.js の フェッチ・サーバアクション エラーを 拾うフック。
 * Sentry SDK が export している `captureRequestError` を そのまま 委譲する。
 */
export { captureRequestError as onRequestError } from "@sentry/nextjs";

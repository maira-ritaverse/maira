/**
 * Sentry サーバ側 (Node ランタイム + Edge ランタイム共用部分) 設定
 *
 * 本ファイルは Next.js 15 + Sentry SDK v8+ の 標準配置 (rootに 置いて
 * instrumentation.ts から動的 import される)。
 *
 * 環境変数:
 *   NEXT_PUBLIC_SENTRY_DSN — 必須。本番でだけ実イベントを送る。
 *   SENTRY_ENVIRONMENT — production / preview / development 等。Vercel が
 *     自動で VERCEL_ENV を 渡してくれる ので そちらを fallback に。
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  // 本番でのみ 100%、それ以外は 0% (preview / dev では Sentry に 送らない)
  enabled: process.env.VERCEL_ENV === "production",
  // パフォーマンス計測は 最小 (10%) で 始める。 必要なら 段階的に 上げる。
  tracesSampleRate: 0.1,
  // 本番でのみ Replays を 有効化 する場合 はここで。
  // 今は サーバ側エラー収集のみで 開始。
});

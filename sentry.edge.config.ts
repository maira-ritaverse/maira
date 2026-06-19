/**
 * Sentry Edge ランタイム (middleware / edge route) 用 設定。
 *
 * Edge では Node API が 使えない ので、最小限の SDK 構成 に する。
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  enabled: process.env.VERCEL_ENV === "production",
  tracesSampleRate: 0.1,
});

/**
 * Sentry クライアント側 (ブラウザ) 設定。
 *
 * Next.js 15 + Sentry SDK v8+ で 推奨される 配置 (instrumentation-client.ts)。
 * このファイルが あれば Next.js が ブラウザ コードに 自動 注入する。
 *
 * 取得対象:
 *   ・未捕捉 JS 例外
 *   ・unhandledrejection
 *   ・ナビゲーション エラー
 *
 * 機密情報の 取扱:
 *   ・本ファイル 自体は ビルド時に 公開される。 DSN は public 値で OK
 *     (Sentry の DSN は 「送信先プロジェクト 識別子」に 過ぎず、平文公開
 *     を 前提に 設計 されている)。
 *   ・本番のみ enabled=true。 dev / preview で 誤送信 を 防ぐ。
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  enabled: process.env.NEXT_PUBLIC_VERCEL_ENV === "production",
  tracesSampleRate: 0.1,
  // Replays は 別途 有効化 する 場合に。 まずは エラー収集 のみ。
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
});

// クライアント側 ナビゲーション の トレース 紐付け (App Router 推奨)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

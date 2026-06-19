import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF 生成で puppeteer-core + @sparticuz/chromium-min をサーバー側で使う。
  // Next.js の bundler に取り込ませると、内部の動的 require / ネイティブ参照が
  // 壊れる(特に chromium-min の brotli 展開や puppeteer-core の chrome devtools
  // 周り)。serverExternalPackages に指定することで、Server Components / Route
  // Handler では node_modules から実体をそのまま読み込む形になり、本番でも安定する。
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

/**
 * Sentry ラッパ:
 *   ・source-maps を Sentry に アップロード (本番 ビルドのみ)
 *   ・トンネル経由で Ad-blocker を回避 (/monitoring へ プロキシ)
 *   ・SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT 環境変数で 認証
 *     (未設定なら 単に ラッパが no-op、ローカルでも 壊れない)
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Source maps の アップロードは 本番のみ で OK
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  // Source maps を 公開せず、Sentry 側でのみ 参照可能 にする
  sourcemaps: { disable: false },
  disableLogger: true,
  automaticVercelMonitors: true,
});

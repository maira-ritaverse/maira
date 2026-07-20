import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * セキュリティ ヘッダ (セキュリティ 監査 H1)。 全 レスポンス に 付与。
 *
 * ・X-Frame-Options: DENY — clickjacking 対策。 Maira は iframe 埋込 を 想定 しない
 * ・X-Content-Type-Options: nosniff — MIME sniffing 対策 (アップロード PDF/画像 の
 *   悪意 の あるコンテンツ が 実行 されない よう に)
 * ・Referrer-Policy: strict-origin-when-cross-origin — 外部 遷移 時 に URL パス
 *   (求職者 ID / 会話 ID など) を Referer に 載せない
 * ・Permissions-Policy: 明示的 に 権限 を 制限。 camera/microphone は 音声 面接
 *   モジュール で 将来 使う ため self、 その他 は 全て 拒否
 * ・Strict-Transport-Security: HSTS。 Vercel が デフォルト で 付ける が 冗長 で 明示
 *
 * ⚠️ CSP (Content-Security-Policy) は 別 タスク で 追加 予定。 Supabase / Stripe /
 *    Sentry / LIFF の allowlist を 個別 に 洗って 動作 確認 する 必要 が あるので
 *    今回 は 見送り。 script-src 'self' から 始めて 段階 的 に 緩め る 方針。
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=*, usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // PDF 生成で puppeteer-core + @sparticuz/chromium-min をサーバー側で使う。
  // Next.js の bundler に取り込ませると、内部の動的 require / ネイティブ参照が
  // 壊れる(特に chromium-min の brotli 展開や puppeteer-core の chrome devtools
  // 周り)。serverExternalPackages に指定することで、Server Components / Route
  // Handler では node_modules から実体をそのまま読み込む形になり、本番でも安定する。
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
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

/**
 * Playwright 設定
 *
 * - test ディレクトリ:e2e/
 * - 開発サーバを起動して実行(CI でも同じ手順)
 * - baseURL:NEXT_PUBLIC_SITE_URL があれば優先、無ければ http://127.0.0.1:3000
 * - Chromium のみ(他ブラウザは必要になったら projects に追加)
 *
 * 実行コマンド(package.json scripts に追加予定):
 *   pnpm e2e            # ヘッドレスで全 spec
 *   pnpm e2e:ui         # 対話モード
 *
 * 認証必須テストは fixtures/auth.ts でログイン Cookie を仕込む方針。
 */
import { defineConfig, devices } from "@playwright/test";

import {
  AGENT_STORAGE_STATE_PATH,
  SEEKER_STORAGE_STATE_PATH,
} from "./e2e/fixtures/test-credentials";

const port = process.env.PORT ?? "3000";
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    // 未認証スモーク(認証 storageState を使わない)
    {
      name: "chromium",
      testMatch: ["smoke.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    // エージェント認証セットアップ
    {
      name: "auth-setup",
      testMatch: /^auth\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 求職者認証セットアップ
    {
      name: "seeker-auth-setup",
      testMatch: /^seeker-auth\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    // 認証済み(agency)プロジェクト
    {
      name: "authenticated",
      testMatch: ["agency-flow.spec.ts"],
      dependencies: ["auth-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: AGENT_STORAGE_STATE_PATH,
      },
    },
    // 認証済み(seeker)プロジェクト
    {
      name: "authenticated-seeker",
      testMatch: ["seeker-flow.spec.ts"],
      dependencies: ["seeker-auth-setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: SEEKER_STORAGE_STATE_PATH,
      },
    },
  ],
  webServer: process.env.E2E_SKIP_SERVER
    ? undefined
    : {
        // pnpm build && pnpm start で起動するのが本来だが、開発高速化のため dev を使う。
        // CI では build 済みのキャッシュを使う事を推奨。
        command: "pnpm dev",
        port: Number(port),
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
      },
});

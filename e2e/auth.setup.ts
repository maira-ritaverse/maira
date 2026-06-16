import { test as setup, expect } from "@playwright/test";

import { AGENT_STORAGE_STATE_PATH, getE2ECredentials } from "./fixtures/test-credentials";

/**
 * 認証セットアップ(全 authenticated spec の事前実行)。
 *
 * /login で資格情報を投入 → セッション Cookie を storageState に保存し、
 * 以降のテストで再利用する。1 回ログインしておけば各 spec で都度ログイン不要。
 */
setup("authenticate as agency member", async ({ page }) => {
  const creds = getE2ECredentials();
  if (!creds) {
    setup.skip(true, "E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD 未設定のためスキップ");
    return;
  }

  await page.goto("/login");
  // ラベル / placeholder のどちらでも引けるよう柔軟に。
  await page
    .getByLabel(/メール|email/i)
    .first()
    .fill(creds.email);
  await page
    .getByLabel(/パスワード|password/i)
    .first()
    .fill(creds.password);
  // ログインボタンは「ログイン」ラベルが基本。
  await page.getByRole("button", { name: /ログイン/i }).click();

  // ログイン成功で /app または /agency に遷移する(account_type 次第)。
  // どちらかに着地したらセッション確立とみなす。
  await page.waitForURL(/\/(agency|app)/, { timeout: 15_000 });

  await page.context().storageState({ path: AGENT_STORAGE_STATE_PATH });

  // 念のため認証後ページが描画されていることを保険として確認。
  await expect(page).toHaveURL(/\/(agency|app)/);
});

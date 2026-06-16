import { test as setup, expect } from "@playwright/test";

import { SEEKER_STORAGE_STATE_PATH, getE2ESeekerCredentials } from "./fixtures/test-credentials";

/**
 * 求職者(seeker)用 認証セットアップ。
 *
 * agency 側と同じパターンで /login → storageState 保存。
 * 環境変数(E2E_TEST_SEEKER_EMAIL / PASSWORD)未設定時はスキップ。
 */
setup("authenticate as seeker", async ({ page }) => {
  const creds = getE2ESeekerCredentials();
  if (!creds) {
    setup.skip(true, "E2E_TEST_SEEKER_EMAIL / E2E_TEST_SEEKER_PASSWORD 未設定のためスキップ");
    return;
  }

  await page.goto("/login");
  await page
    .getByLabel(/メール|email/i)
    .first()
    .fill(creds.email);
  await page
    .getByLabel(/パスワード|password/i)
    .first()
    .fill(creds.password);
  await page.getByRole("button", { name: /ログイン/i }).click();

  // seeker ログイン後は /app へ。account_type=individual ならここに着地。
  await page.waitForURL(/\/app/, { timeout: 15_000 });
  await page.context().storageState({ path: SEEKER_STORAGE_STATE_PATH });
  await expect(page).toHaveURL(/\/app/);
});

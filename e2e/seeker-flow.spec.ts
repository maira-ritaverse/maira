import { expect, test } from "@playwright/test";

import { getE2ESeekerCredentials } from "./fixtures/test-credentials";

/**
 * 求職者(seeker)側 認証付きフロー。
 *
 * 前提:
 *   - playwright.config.ts の "authenticated-seeker" project で
 *     storageState を仕込んでいる
 *   - 該当ユーザは個人アカウント(organization_member ではない)
 *
 * 範囲(画面到達確認):
 *   - /app(ダッシュボード)
 *   - /app/recommended-jobs(AI 求人推薦)
 *   - /app/agent-referrals(エージェント推薦進捗)
 *   - /app/career-intake(AI ヒアリング)
 *   - /app/applications(応募管理)
 *   - /app/resumes(履歴書)
 *
 * 機能検証(連携 / Stripe / OpenAI 等)が必要な深い E2E は別 spec。
 */

test.describe("seeker authenticated flows", () => {
  test.beforeEach(() => {
    if (!getE2ESeekerCredentials()) {
      test.skip(true, "E2E seeker 資格情報が未設定のためスキップ");
    }
  });

  test("ダッシュボードに到達する", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app(?!\/)/);
  });

  test("AI 求人推薦ページに到達する", async ({ page }) => {
    await page.goto("/app/recommended-jobs");
    await expect(
      page.getByRole("heading", { name: /AI 求人推薦|あなたへの AI 求人推薦/ }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("エージェント推薦進捗に到達する", async ({ page }) => {
    await page.goto("/app/agent-referrals");
    await expect(page.getByRole("heading", { name: /エージェントの推薦進捗/ })).toBeVisible();
  });

  test("AI ヒアリングに到達する", async ({ page }) => {
    await page.goto("/app/career-intake");
    await expect(page.getByRole("heading", { name: /AI ヒアリング/ })).toBeVisible();
  });

  test("応募管理に到達する", async ({ page }) => {
    await page.goto("/app/applications");
    // 「応募管理」ヘディング、または空状態の文言いずれかで OK
    await expect(page.locator("h1, h2").filter({ hasText: /応募管理|応募はまだ/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("履歴書一覧に到達する", async ({ page }) => {
    await page.goto("/app/resumes");
    await expect(page.locator("h1, h2").filter({ hasText: /履歴書/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});

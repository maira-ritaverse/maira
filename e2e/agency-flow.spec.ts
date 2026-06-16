import { test, expect } from "@playwright/test";

import { getE2ECredentials } from "./fixtures/test-credentials";

/**
 * 認証済みのエージェント側スモークテスト。
 *
 * 前提:
 *   - playwright.config.ts の "authenticated" project で storageState を仕込んでいる
 *   - 該当ユーザは organization_member(advisor 以上)である必要がある
 *
 * テスト範囲(まずは画面到達の確認):
 *   - /agency ダッシュボード
 *   - /agency/clients
 *   - /agency/jobs
 *   - /agency/calendar
 *   - /agency/settings
 */

test.describe("agency authenticated flows", () => {
  test.beforeEach(() => {
    if (!getE2ECredentials()) {
      test.skip(true, "E2E 資格情報が未設定のためスキップ");
    }
  });

  test("ダッシュボードに到達する", async ({ page }) => {
    await page.goto("/agency");
    await expect(page).toHaveURL(/\/agency(?!\/)/);
    await expect(page.getByRole("heading", { name: /ダッシュボード/ })).toBeVisible();
  });

  test("クライアント一覧に到達する", async ({ page }) => {
    await page.goto("/agency/clients");
    await expect(page.getByRole("heading", { name: /クライアント管理/ })).toBeVisible();
  });

  test("求人一覧に到達する", async ({ page }) => {
    await page.goto("/agency/jobs");
    await expect(page.getByRole("heading", { name: /求人管理/ })).toBeVisible();
  });

  test("カレンダーに到達する", async ({ page }) => {
    await page.goto("/agency/calendar");
    await expect(page.getByRole("heading", { name: /カレンダー/ })).toBeVisible();
  });

  test("個人設定に到達する", async ({ page }) => {
    await page.goto("/agency/settings");
    await expect(page.getByRole("heading", { name: /個人設定/ })).toBeVisible();
  });

  test("AI 利用状況ページ(admin)が表示される or リダイレクトされる", async ({ page }) => {
    // admin ならページ到達、advisor ならリダイレクト → どちらでも壊れていなければ OK
    const res = await page.goto("/agency/settings/ai-usage");
    expect(res?.status() ?? 0).toBeLessThan(500);
    const url = page.url();
    // admin: /agency/settings/ai-usage のまま、advisor: /agency に飛ぶ
    expect(/\/agency(\/|$)/.test(url)).toBe(true);
  });
});

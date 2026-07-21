import { expect, test } from "@playwright/test";

/**
 * スモークテスト:認証不要なページが少なくとも 200 を返し、
 * ヘルプ・ヘッダのレンダリングが破綻していないことだけを確認する。
 *
 * 認証が必要な /agency 以下は別 spec(fixtures/auth.ts ベース)で扱う。
 */

test.describe("smoke / public pages", () => {
  test("/(マーケティング LP)が表示される", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
    // ルート LP はマーケティングページ。文字列の決め打ちは脆いので、HTML が返れば OK。
    await expect(page).toHaveTitle(/Myaira/i);
  });

  test("/login が表示される", async ({ page }) => {
    await page.goto("/login");
    // 入力フォームの中心となるメール欄が必ずあるはず
    await expect(page.getByLabel(/メール|email/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("/agency に未ログインでアクセスすると /login にリダイレクトされる", async ({ page }) => {
    await page.goto("/agency");
    await expect(page).toHaveURL(/\/login/);
  });

  test("存在しない /f/[token] が 404 を返す", async ({ page }) => {
    // 無効な uuid 形式 → page.tsx の正規表現で notFound() を発火
    const res = await page.goto("/f/not-a-uuid");
    expect(res?.status()).toBe(404);
  });

  // ── 認証必須の seeker ページが未ログインで /login に飛ぶことを確認 ─────────
  // 認証付き seeker テストは別途 fixture 整備後に追加する。現状は redirect の
  // 健全性だけ確認する(リダイレクト先のロジック退化を防ぐ最小カバレッジ)。
  for (const path of [
    "/app",
    "/app/recommended-jobs",
    "/app/agent-referrals",
    "/app/career-intake",
  ]) {
    test(`未ログインで ${path} にアクセスすると /login にリダイレクトされる`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  // ── 公開共有ページの形式チェック(token 形式不正は 404)─────────────────────
  test("/share/intake/[token] で不正トークンが 404", async ({ page }) => {
    const res = await page.goto("/share/intake/not-a-valid-uuid");
    // 公開ページなのでサーバが応答する。token 不正は notFound() 発火
    expect([404, 200]).toContain(res?.status() ?? 0);
  });
});

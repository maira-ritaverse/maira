import { describe, it, expect } from "vitest";
import { buildResumeHtml } from "./resume-html";
import type { Resume } from "./types";

/**
 * 履歴書 HTML ビルダーのテスト。
 *
 * 主な責務はセキュリティ:
 *   - ユーザー入力(氏名・住所・志望動機等)を escapeHtml に通して埋め込む
 *   - 漏れがあると Puppeteer 内で任意スクリプト実行 / PDF 構造破壊 / </body> 注入が起こる
 *
 * フォーマット責務:
 *   - 生年月日が空 / 不正値でも出力が壊れない(プレースホルダ枠を保つ)
 *   - documentDate が null なら本日にフォールバック / 不正値も本日に倒す
 *   - 履歴行が ROWS_HISTORY_PAGE_1(15)を超えると 2 ページ目に分割
 *   - 写真 URL が null ならプレースホルダ
 *
 * 全テスト戻り値は HTML 文字列なので、文字列 includes / 正規表現で検証する。
 */

const baseResume: Resume = {
  id: "r1",
  userId: "u1",
  title: "テスト履歴書",
  name: "田中太郎",
  nameKana: "タナカタロウ",
  birthDate: "2000-04-15",
  gender: "male",
  postalCode: "100-0001",
  address: "東京都千代田区千代田1-1",
  addressKana: "トウキョウト",
  phone: "03-1234-5678",
  email: "tanaka@example.com",
  contactAddress: null,
  contactAddressKana: null,
  contactPhone: null,
  photoUrl: null,
  documentDate: "2026-06-14",
  educationHistory: [],
  licenses: [],
  motivationNote: "貴社の理念に共感しました。",
  personalRequests: "リモート希望。",
  createdAt: "2026-06-14T00:00:00Z",
  updatedAt: "2026-06-14T00:00:00Z",
};

describe("buildResumeHtml — XSS 防御(escapeHtml)", () => {
  it("氏名に <script> を埋め込まれても無害化される", () => {
    const html = buildResumeHtml(
      { ...baseResume, name: "<script>alert(1)</script>" },
      { photoSignedUrl: null },
    );
    // <script> タグそのものが出力に残らない
    expect(html).not.toContain("<script>alert(1)</script>");
    // エスケープされた形で残る
    expect(html).toContain("&lt;script&gt;");
  });

  it("</body> を仕込まれても文書構造が壊れない", () => {
    const html = buildResumeHtml(
      { ...baseResume, motivationNote: "abc</body><script>evil()</script>" },
      { photoSignedUrl: null },
    );
    // </body> が「motivationNote 経由で」出力されていないこと
    // HTML 本来の </body>(1 つ)だけ存在することを確認
    const closingBodyCount = (html.match(/<\/body>/g) ?? []).length;
    expect(closingBodyCount).toBe(1);
    expect(html).not.toContain("<script>evil()</script>");
  });

  it("住所のダブルクォート / シングルクォートも escape", () => {
    const html = buildResumeHtml({ ...baseResume, address: "a\"b'c" }, { photoSignedUrl: null });
    expect(html).not.toContain("a\"b'c"); // 生の形では出ない
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
  });

  it("personal_requests に & が含まれても無害化(二重エスケープにならない)", () => {
    const html = buildResumeHtml(
      { ...baseResume, personalRequests: "A & B" },
      { photoSignedUrl: null },
    );
    expect(html).toContain("A &amp; B");
    expect(html).not.toContain("A &amp;amp; B"); // 二重 escape されてない
  });
});

describe("buildResumeHtml — 必須コンテンツ埋め込み", () => {
  it("氏名・住所・志望動機が出力に含まれる", () => {
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    expect(html).toContain("田中太郎");
    expect(html).toContain("東京都千代田区");
    expect(html).toContain("貴社の理念に共感しました");
  });

  it("documentDate が指定されていればその日付(西暦)を出す", () => {
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    expect(html).toMatch(/2026\s*年\s*6\s*月\s*14\s*日/);
  });

  it("documentDate が null なら今日の日付にフォールバック", () => {
    const html = buildResumeHtml({ ...baseResume, documentDate: null }, { photoSignedUrl: null });
    const today = new Date();
    const expected = `${today.getFullYear()} 年`;
    expect(html).toContain(expected);
  });

  it("documentDate が不正値(NaN になる)でも壊れず今日にフォールバック", () => {
    const html = buildResumeHtml(
      { ...baseResume, documentDate: "not-a-date" },
      { photoSignedUrl: null },
    );
    const today = new Date();
    expect(html).toContain(`${today.getFullYear()} 年`);
  });
});

describe("buildResumeHtml — 生年月日のフォーマット", () => {
  it("生年月日があれば 'YYYY年 M月 D日生 (満 N 歳)' 表記", () => {
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    expect(html).toMatch(/2000年\s*4月\s*15日生/);
  });

  it("生年月日が null ならプレースホルダ枠(全角空白の年月日)を残す", () => {
    const html = buildResumeHtml({ ...baseResume, birthDate: null }, { photoSignedUrl: null });
    expect(html).toContain("年");
    expect(html).toContain("月");
    expect(html).toContain("日生");
  });
});

describe("buildResumeHtml — 写真 URL", () => {
  it("photoSignedUrl が null ならプレースホルダ(写真 URL は img に出ない)", () => {
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    expect(html).not.toContain('src="https://');
  });

  it("photoSignedUrl が指定されていれば img の src に入る", () => {
    const url = "https://example.com/signed-url/abc?token=xxx";
    const html = buildResumeHtml(baseResume, { photoSignedUrl: url });
    expect(html).toContain(url);
  });

  it("photoSignedUrl もエスケープされる(quote を含む URL でも壊れない)", () => {
    // クエリ文字列に " を仕込むケース(理論上はあり得ないが防御で escape)
    const url = 'https://example.com/x?"injection';
    const html = buildResumeHtml(baseResume, { photoSignedUrl: url });
    expect(html).not.toContain('"injection'); // 生の " 形では入らない
    expect(html).toContain("&quot;injection");
  });
});

describe("buildResumeHtml — 学歴・職歴の行数調整", () => {
  it("学歴行が空でもプレースホルダで 15 行枠が保たれる(<tr> が一定数出る)", () => {
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    // <tr が「ヘッダ + 15 + 8 + 8」程度出るはず(厳密な数字は実装依存だが下限を確認)
    const trCount = (html.match(/<tr/g) ?? []).length;
    expect(trCount).toBeGreaterThan(20);
  });

  it("15 行を超える履歴は 2 ページ目にも分割される(15 + 8 = 23 行枠まで埋まる)", () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      year: 2000 + i,
      month: 4,
      description: `イベント${i + 1}`,
    }));
    const html = buildResumeHtml(
      { ...baseResume, educationHistory: longHistory },
      { photoSignedUrl: null },
    );
    // 全 20 件が html に登場することを確認(2 ページ目分も含む)
    for (let i = 0; i < 20; i++) {
      expect(html).toContain(`イベント${i + 1}`);
    }
  });
});

describe("buildResumeHtml — 出力構造の妥当性", () => {
  it("DOCTYPE + html + head + body を含む最小構造", () => {
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  it("日本語 Web フォント(Noto Serif JP)が link または style で読み込まれる", () => {
    // 本番(Chromium)で豆腐にならないように Web フォントを埋め込む契約
    const html = buildResumeHtml(baseResume, { photoSignedUrl: null });
    expect(html).toContain("Noto Serif JP");
  });
});

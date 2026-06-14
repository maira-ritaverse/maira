import { describe, it, expect } from "vitest";
import { buildCvHtml } from "./cv-html";
import type { CvBody, WorkExperience } from "./types";
import type { LicenseItem } from "@/lib/resumes/types";

/**
 * 職務経歴書 HTML ビルダーのテスト。
 *
 * 履歴書(resume-html)と同じ「ユーザー入力 → Puppeteer HTML」の責務。
 * XSS 防御の漏れがあれば PDF が壊れる / 任意スクリプトが走るので、各 user input
 * フィールド(会社名・業務内容・実績・スキル名・自己 PR 等)で escapeHtml が
 * かかっていることを担保する。
 *
 * 履歴書と違って職務経歴書は内容量可変で「(未入力)」プレースホルダの出し分けが
 * あるので、空配列ケースの挙動も明示テスト。
 */

const emptyBody: CvBody = {
  summary: "",
  work_experiences: [],
  skills: [],
  self_pr: "",
};

function workExp(overrides: Partial<WorkExperience> = {}): WorkExperience {
  return {
    company_name: "テスト会社",
    industry: null,
    period_start: { year: 2020, month: 4 },
    period_end: null,
    position: "エンジニア",
    employment_type: "full_time",
    job_description: "Web 開発",
    achievements: "売上 1.5 倍",
    ...overrides,
  };
}

function license(name: string): LicenseItem {
  return { year: 2020, month: 4, name };
}

describe("buildCvHtml — 基本構造", () => {
  it("DOCTYPE + html + head + body / Noto Serif JP 埋め込み", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: "田中",
      licenses: [],
      documentDate: "2026-06-14",
      title: "職務経歴書",
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain("</body>");
    expect(html).toContain("Noto Serif JP");
  });

  it("title はエスケープされてタブ表記に入る", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: null,
      licenses: [],
      documentDate: null,
      title: "<script>x</script>",
    });
    // <title> 中の <script> が生で残らない
    expect(html).toContain("<title>&lt;script&gt;");
  });
});

describe("buildCvHtml — XSS 防御(各フィールド)", () => {
  it("summary に <script> を入れても無害化", () => {
    const html = buildCvHtml({
      body: { ...emptyBody, summary: "<script>evil()</script>" },
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).not.toContain("<script>evil()</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("self_pr に </body> を仕込まれても本来の </body> だけ", () => {
    const html = buildCvHtml({
      body: { ...emptyBody, self_pr: "abc</body><script>x</script>" },
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect((html.match(/<\/body>/g) ?? []).length).toBe(1);
    expect(html).not.toContain("<script>x</script>");
  });

  it("会社名 / 業務内容 / 実績 の各フィールドが escape される", () => {
    const html = buildCvHtml({
      body: {
        ...emptyBody,
        work_experiences: [
          workExp({
            company_name: "<X>",
            job_description: "<Y>",
            achievements: "<Z>",
          }),
        ],
      },
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).not.toContain("<X>");
    expect(html).not.toContain("<Y>");
    expect(html).not.toContain("<Z>");
    expect(html).toContain("&lt;X&gt;");
    expect(html).toContain("&lt;Y&gt;");
    expect(html).toContain("&lt;Z&gt;");
  });

  it("スキル名 / 説明も escape", () => {
    const html = buildCvHtml({
      body: {
        ...emptyBody,
        skills: [
          {
            category: "language",
            name: '"injection"',
            level: "advanced",
            description: "<bad>",
          },
        ],
      },
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).not.toContain('"injection"');
    expect(html).not.toContain("<bad>");
    expect(html).toContain("&quot;injection&quot;");
    expect(html).toContain("&lt;bad&gt;");
  });

  it("資格名(履歴書から引いた値)も escape", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: "田中",
      licenses: [license("<malicious>")],
      documentDate: null,
      title: "x",
    });
    expect(html).not.toContain("<malicious>");
    expect(html).toContain("&lt;malicious&gt;");
  });

  it("name もエスケープされる", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: "<script>",
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).not.toContain("<script>"); // 本物の <script> タグは出ない
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildCvHtml — 空配列のプレースホルダ", () => {
  it("work_experiences が空なら (未入力) を表示", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).toContain("(未入力)");
  });

  it("licenses が空 + name=null なら「履歴書を選択すると…」プレースホルダ", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).toContain("履歴書を選択");
  });

  it("licenses が空 + name 指定なら「資格が登録されていません」プレースホルダ", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: "田中",
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).toContain("資格が登録されていません");
  });
});

describe("buildCvHtml — 必須コンテンツ埋め込み", () => {
  it("会社名・業務内容・実績が出力に含まれる", () => {
    const html = buildCvHtml({
      body: {
        ...emptyBody,
        work_experiences: [workExp({ company_name: "ABC 株式会社" })],
      },
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    expect(html).toContain("ABC 株式会社");
    expect(html).toContain("Web 開発");
    expect(html).toContain("売上 1.5 倍");
  });

  it("documentDate=null なら今日の西暦日付にフォールバック", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: null,
      licenses: [],
      documentDate: null,
      title: "x",
    });
    const today = new Date();
    expect(html).toContain(`${today.getFullYear()} 年`);
  });

  it("documentDate が不正値でも壊れず本日にフォールバック", () => {
    const html = buildCvHtml({
      body: emptyBody,
      name: null,
      licenses: [],
      documentDate: "not-a-date",
      title: "x",
    });
    const today = new Date();
    expect(html).toContain(`${today.getFullYear()} 年`);
  });
});

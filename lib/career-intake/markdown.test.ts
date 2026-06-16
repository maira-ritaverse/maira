import { describe, expect, it } from "vitest";

import { extractionToMarkdown } from "./markdown";
import type { ExtractionResult } from "./types";

function ext(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    educationHistory: [],
    workHistory: [],
    licenses: [],
    workExperiences: [],
    skills: [],
    desiredIndustries: [],
    desiredOccupations: [],
    desiredLocations: [],
    ...overrides,
  };
}

describe("extractionToMarkdown", () => {
  it("空のときは見出しだけ", () => {
    const md = extractionToMarkdown(ext());
    expect(md).toContain("# キャリアサマリ");
  });

  it("title オプションを反映", () => {
    const md = extractionToMarkdown(ext(), { title: "Foo" });
    expect(md.split("\n")[0]).toBe("# Foo");
  });

  it("careerSummary は ## 職務サマリ で出力", () => {
    const md = extractionToMarkdown(ext({ careerSummary: "5 年のバックエンド経験" }));
    expect(md).toContain("## 職務サマリ");
    expect(md).toContain("5 年のバックエンド経験");
  });

  it("workExperiences は会社名 + 期間 + 業務 + 実績を含む", () => {
    const md = extractionToMarkdown(
      ext({
        workExperiences: [
          {
            companyName: "○○株式会社",
            industry: "Web",
            position: "エンジニア",
            startYear: 2022,
            startMonth: 4,
            endYear: null,
            endMonth: null,
            jobDescription: "バックエンド",
            achievements: "新規 API",
          },
        ],
      }),
    );
    expect(md).toContain("### ○○株式会社");
    expect(md).toContain("Web / エンジニア");
    expect(md).toContain("2022年4月 〜 現在");
    expect(md).toContain("業務内容:");
    expect(md).toContain("バックエンド");
    expect(md).toContain("実績:");
  });

  it("skills は箇条書きで level あり", () => {
    const md = extractionToMarkdown(
      ext({
        skills: [
          { category: "language", name: "TypeScript", level: "advanced" },
          { category: "framework", name: "Next.js", level: null },
        ],
      }),
    );
    expect(md).toContain("- TypeScript (advanced)");
    expect(md).toContain("- Next.js");
  });

  it("希望条件は希望年収を 万円 単位で出す", () => {
    const md = extractionToMarkdown(
      ext({
        desiredIndustries: ["IT"],
        desiredAnnualIncome: 600,
      }),
    );
    expect(md).toContain("業界: IT");
    expect(md).toContain("希望年収: 600 万円");
  });

  it("educationHistory は year/month が両方無いと ? に倒れる", () => {
    const md = extractionToMarkdown(
      ext({
        educationHistory: [{ year: null, month: null, description: "○○大学 卒業" }],
      }),
    );
    expect(md).toContain("- ?: ○○大学 卒業");
  });
});

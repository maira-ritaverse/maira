import { describe, expect, it } from "vitest";

import { extractionResultSchema } from "./types";

describe("extractionResultSchema", () => {
  it("空オブジェクトでも通る(全て optional + default)", () => {
    const r = extractionResultSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.educationHistory).toEqual([]);
      expect(r.data.workHistory).toEqual([]);
      expect(r.data.licenses).toEqual([]);
      expect(r.data.workExperiences).toEqual([]);
      expect(r.data.skills).toEqual([]);
      expect(r.data.desiredIndustries).toEqual([]);
    }
  });

  it("最小構成(必要なフィールドだけ)で通る", () => {
    const r = extractionResultSchema.safeParse({
      careerSummary: "5 年のバックエンド経験",
      motivationNote: "成長機会を求めて",
      desiredAnnualIncome: 600,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.careerSummary).toBe("5 年のバックエンド経験");
      expect(r.data.desiredAnnualIncome).toBe(600);
    }
  });

  it("educationHistory は year / month / description を持つ", () => {
    const r = extractionResultSchema.safeParse({
      educationHistory: [{ year: 2018, month: 4, description: "○○大学 入学" }],
    });
    expect(r.success).toBe(true);
  });

  it("year が範囲外なら失敗", () => {
    const r = extractionResultSchema.safeParse({
      educationHistory: [{ year: 1900, month: 4, description: "test" }],
    });
    expect(r.success).toBe(false);
  });

  it("workExperiences の period 部分は数値 or null", () => {
    const r = extractionResultSchema.safeParse({
      workExperiences: [
        {
          companyName: "○○株式会社",
          startYear: 2022,
          startMonth: 4,
          endYear: null,
          endMonth: null,
          jobDescription: "バックエンド開発",
          achievements: "新規 API を 10 本実装",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("skills.category が enum 外なら失敗", () => {
    const r = extractionResultSchema.safeParse({
      skills: [{ category: "unknown_category", name: "TypeScript" }],
    });
    expect(r.success).toBe(false);
  });

  it("skills.level は basic / intermediate / advanced のみ", () => {
    const ok = extractionResultSchema.safeParse({
      skills: [{ category: "language", name: "TS", level: "advanced" }],
    });
    expect(ok.success).toBe(true);
    const ng = extractionResultSchema.safeParse({
      skills: [{ category: "language", name: "TS", level: "expert" }],
    });
    expect(ng.success).toBe(false);
  });

  it("desiredAnnualIncome は 0〜99999 万円", () => {
    expect(extractionResultSchema.safeParse({ desiredAnnualIncome: 0 }).success).toBe(true);
    expect(extractionResultSchema.safeParse({ desiredAnnualIncome: 99999 }).success).toBe(true);
    expect(extractionResultSchema.safeParse({ desiredAnnualIncome: -1 }).success).toBe(false);
    expect(extractionResultSchema.safeParse({ desiredAnnualIncome: 100000 }).success).toBe(false);
  });

  it("nameKana は null 許容", () => {
    expect(extractionResultSchema.safeParse({ nameKana: null }).success).toBe(true);
    expect(extractionResultSchema.safeParse({ nameKana: "タナカタロウ" }).success).toBe(true);
  });

  it("description が 200 文字超は失敗", () => {
    const long = "a".repeat(201);
    const r = extractionResultSchema.safeParse({
      educationHistory: [{ year: 2018, month: 4, description: long }],
    });
    expect(r.success).toBe(false);
  });
});

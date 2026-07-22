import { describe, expect, it } from "vitest";

import { extractionResultSchema } from "@/lib/career-intake/types";

import { mergeExtractionIntoCvBody, mergeExtractionIntoResumePii } from "./extraction-to-resume";
import { cvBodySchema, resumePiiSchema } from "./types";

/**
 * 回帰テスト(サイレントなデータ損失の防止)
 *
 * 抽出側(extractionResultSchema)は selfPr / careerSummary / motivationNote /
 * workExperiences(件数・本文とも実質無上限)を許容する。これを merge した結果が
 * 保存スキーマ(resumePiiSchema / cvBodySchema)の .max() を超えると、読込時の
 * parseResumePii / parseCvBody が parse 失敗で「全体を空」に倒し、履歴書 /
 * 職務経歴書がまるごと消える。merge 側で各項目を上限に収めることを保証する。
 */
describe("extraction merge は保存スキーマ上限に収める(全体空化の防止)", () => {
  it("mergeExtractionIntoCvBody: 職歴が多くても body は 20000 以内で cvBodySchema を通る", () => {
    const bigJob = {
      companyName: "株式会社テスト",
      jobDescription: "あ".repeat(2000),
      achievements: "い".repeat(2000),
    };
    const extraction = extractionResultSchema.parse({
      workExperiences: Array.from({ length: 10 }, () => bigJob),
      careerSummary: "う".repeat(5000),
    });

    const merged = mergeExtractionIntoCvBody({ summary: "", body: "" }, extraction);

    expect(merged.body.length).toBeLessThanOrEqual(20000);
    expect(merged.summary.length).toBeLessThanOrEqual(2000);
    // 読込時の検証(parseCvBody 相当)で throw しない = 空に倒れない
    expect(() => cvBodySchema.parse(merged)).not.toThrow();
  });

  it("mergeExtractionIntoResumePii: 長い自己PR/志望動機/希望条件でも各上限に収まり resumePiiSchema を通る", () => {
    const extraction = extractionResultSchema.parse({
      selfPr: "x".repeat(5000),
      motivationNote: "y".repeat(5000),
      nameKana: "カ".repeat(300),
      desiredIndustries: Array.from({ length: 50 }, (_, i) => `業種${i}`),
      desiredOccupations: Array.from({ length: 50 }, (_, i) => `職種${i}`),
    });

    const emptyPii = resumePiiSchema.parse({});
    const merged = mergeExtractionIntoResumePii(emptyPii, extraction, "山田 太郎");

    expect(merged.self_pr.length).toBeLessThanOrEqual(2000);
    expect(merged.motivation.length).toBeLessThanOrEqual(2000);
    expect(merged.full_name_kana.length).toBeLessThanOrEqual(100);
    expect(merged.preferences.length).toBeLessThanOrEqual(1000);
    // 読込時の検証(parseResumePii 相当)で throw しない = 空に倒れない
    expect(() => resumePiiSchema.parse(merged)).not.toThrow();
  });

  it("既存値がある場合は上書きせず保持しつつ、それも上限に収める", () => {
    const extraction = extractionResultSchema.parse({ selfPr: "z".repeat(5000) });
    const current = resumePiiSchema.parse({ self_pr: "既存の自己PR" });

    const merged = mergeExtractionIntoResumePii(current, extraction, "山田 太郎");

    // 既存値があるので抽出値では上書きしない
    expect(merged.self_pr).toBe("既存の自己PR");
  });
});

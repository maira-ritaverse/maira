import { describe, expect, it } from "vitest";

import { AI_KIND_LABEL, AI_KIND_UNIT_COST_USD, estimateCostUsd } from "./ai-usage-queries";

describe("AI_KIND_LABEL", () => {
  it("既存 + 拡張した kind すべてに日本語ラベルがある", () => {
    expect(AI_KIND_LABEL.photo_enhance).toBeTruthy();
    expect(AI_KIND_LABEL.job_recommendation_seeker).toBeTruthy();
    expect(AI_KIND_LABEL.job_recommendation_agency).toBeTruthy();
    expect(AI_KIND_LABEL.recommendation_letter_draft).toBeTruthy();
    expect(AI_KIND_LABEL.agency_cv_draft).toBeTruthy();
    expect(AI_KIND_LABEL.agency_resume_draft).toBeTruthy();
  });
});

describe("AI_KIND_UNIT_COST_USD", () => {
  it("価格が正の数で設定されている", () => {
    expect(AI_KIND_UNIT_COST_USD.photo_enhance).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.job_recommendation_seeker).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.job_recommendation_agency).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.recommendation_letter_draft).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.agency_cv_draft).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.agency_resume_draft).toBeGreaterThan(0);
  });
});

describe("estimateCostUsd", () => {
  it("空オブジェクトは 0", () => {
    expect(estimateCostUsd({})).toBe(0);
  });

  it("photo_enhance 5 件 × $0.04 = $0.20", () => {
    expect(estimateCostUsd({ photo_enhance: 5 })).toBeCloseTo(0.2, 2);
  });

  it("複数 kind を合算", () => {
    // 0.04*1 + 0.0135*10 + 0.0135*5 = 0.04 + 0.135 + 0.0675 = 0.2425 → round2 = 0.24
    expect(
      estimateCostUsd({
        photo_enhance: 1,
        job_recommendation_seeker: 10,
        job_recommendation_agency: 5,
      }),
    ).toBeCloseTo(0.24, 2);
  });

  it("未知の kind は 0 単価扱い(silent ignore)", () => {
    // photo_enhance 1 件 = $0.04、未知 kind は無視
    expect(estimateCostUsd({ unknown_kind: 100, photo_enhance: 1 })).toBeCloseTo(0.04, 2);
  });

  it("小数第 2 位で丸める", () => {
    // 0.04 * 3 = 0.12 ちょうど(浮動小数誤差検証)
    expect(estimateCostUsd({ photo_enhance: 3 })).toBe(0.12);
  });
});

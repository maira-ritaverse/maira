import { describe, expect, it } from "vitest";

import { AI_KIND_LABEL, AI_KIND_UNIT_COST_USD, estimateCostUsd } from "./ai-usage-queries";

describe("AI_KIND_LABEL", () => {
  it("3 種類の kind すべてに日本語ラベルがある", () => {
    expect(AI_KIND_LABEL.photo_enhance).toBeTruthy();
    expect(AI_KIND_LABEL.job_recommendation_seeker).toBeTruthy();
    expect(AI_KIND_LABEL.job_recommendation_agency).toBeTruthy();
  });
});

describe("AI_KIND_UNIT_COST_USD", () => {
  it("価格が正の数で設定されている", () => {
    expect(AI_KIND_UNIT_COST_USD.photo_enhance).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.job_recommendation_seeker).toBeGreaterThan(0);
    expect(AI_KIND_UNIT_COST_USD.job_recommendation_agency).toBeGreaterThan(0);
  });
});

describe("estimateCostUsd", () => {
  it("空オブジェクトは 0", () => {
    expect(estimateCostUsd({})).toBe(0);
  });

  it("photo_enhance 5 件 × $0.07 = $0.35", () => {
    expect(estimateCostUsd({ photo_enhance: 5 })).toBeCloseTo(0.35, 2);
  });

  it("複数 kind を合算", () => {
    // 0.07*1 + 0.02*10 + 0.02*5 = 0.07 + 0.20 + 0.10 = 0.37
    expect(
      estimateCostUsd({
        photo_enhance: 1,
        job_recommendation_seeker: 10,
        job_recommendation_agency: 5,
      }),
    ).toBeCloseTo(0.37, 2);
  });

  it("未知の kind は 0 単価扱い(silent ignore)", () => {
    expect(estimateCostUsd({ unknown_kind: 100, photo_enhance: 1 })).toBeCloseTo(0.07, 2);
  });

  it("小数第 2 位で丸める", () => {
    // 0.07 * 3 = 0.21 ちょうど(浮動小数誤差検証)
    expect(estimateCostUsd({ photo_enhance: 3 })).toBe(0.21);
  });
});

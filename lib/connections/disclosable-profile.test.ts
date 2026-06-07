import { describe, it, expect } from "vitest";
import type { CareerProfile } from "@/lib/career/profile-schema";
import { extractDisclosableProfile, type DisclosableProfile } from "./disclosable-profile";

/**
 * Phase 5 漏洩テスト:
 *   extractDisclosableProfile の戻り値に、内面フィールド
 *   (strengths / values / concerns / summary / diagnosis)と user_facts.company_size
 *   が一切含まれないことを、キー集合レベルで検証する。
 *
 * 値の正しさよりも「内面キーが漏れていない」ことを最優先で確かめる。
 * 値検証は型レベルで担保されているので最小限。
 */

// 内面・希望条件すべてに「内面とわかる」値を入れた合成 CareerProfile。
// extractDisclosableProfile が間違って内面をコピーしたら、JSON.stringify 結果に
// 内面の sentinel 文字列が現れる(その負の検証もする)。
const SYNTH_PROFILE: CareerProfile = {
  user_facts: {
    current_role: "Software Engineer",
    years_of_experience: 5,
    industry: "Tech",
    company_size: "INTERNAL-COMPANY-SIZE-SHOULD-NOT-LEAK",
  },
  strengths: [
    {
      label: "INTERNAL-STRENGTH-SHOULD-NOT-LEAK",
      evidence: "evidence",
      category: "hard_skill",
    },
  ],
  values: ["INTERNAL-VALUE-SHOULD-NOT-LEAK"],
  wants: {
    industries: ["FinTech"],
    role_types: ["Backend"],
    company_sizes: ["1000名以上"],
  },
  concerns: ["INTERNAL-CONCERN-SHOULD-NOT-LEAK"],
  summary: "INTERNAL-SUMMARY-SHOULD-NOT-LEAK",
  diagnosis: {
    axis: {
      primary: "specialist",
      secondary: null,
      scores: {
        specialist: 5,
        management: 0,
        autonomy: 0,
        security: 0,
        entrepreneur: 0,
        service: 0,
        challenge: 0,
        lifestyle: 0,
      },
    },
    aptitude: {
      scores: {
        openness: 5,
        conscientiousness: 5,
        extraversion: 5,
        agreeableness: 5,
        stability: 5,
      },
      topStrengths: [],
    },
    jobs: {
      categories: [],
      aptitudeHint: "INTERNAL-DIAGNOSIS-HINT-SHOULD-NOT-LEAK",
    },
    explanation: "INTERNAL-DIAGNOSIS-EXPLANATION-SHOULD-NOT-LEAK",
    createdAt: "2026-06-07T00:00:00Z",
  },
};

describe("extractDisclosableProfile", () => {
  const out: DisclosableProfile = extractDisclosableProfile(SYNTH_PROFILE);
  const serialized = JSON.stringify(out);

  it("トップキーは wants と user_facts のみ", () => {
    expect(Object.keys(out).sort()).toEqual(["user_facts", "wants"]);
  });

  it("user_facts のキーは current_role / years_of_experience / industry のみ(company_size は含まない)", () => {
    expect(Object.keys(out.user_facts).sort()).toEqual([
      "current_role",
      "industry",
      "years_of_experience",
    ]);
    expect("company_size" in out.user_facts).toBe(false);
  });

  it("wants のキーは industries / role_types / company_sizes のみ(wants.company_sizes は希望なので開示)", () => {
    expect(Object.keys(out.wants).sort()).toEqual(["company_sizes", "industries", "role_types"]);
  });

  it("内面トップキー(strengths/values/concerns/summary/diagnosis)はトップに存在しない", () => {
    for (const k of ["strengths", "values", "concerns", "summary", "diagnosis"]) {
      expect(k in out).toBe(false);
    }
  });

  it("シリアライズ結果に内面の sentinel 文字列が一切現れない(深いコピー漏れの保険)", () => {
    // 内面の各 sentinel を「絶対に含まれていない」と検証することで、将来
    // スプレッド演算子を間違って入れたときに即座に検知できる。
    const forbiddenSentinels = [
      "INTERNAL-COMPANY-SIZE-SHOULD-NOT-LEAK",
      "INTERNAL-STRENGTH-SHOULD-NOT-LEAK",
      "INTERNAL-VALUE-SHOULD-NOT-LEAK",
      "INTERNAL-CONCERN-SHOULD-NOT-LEAK",
      "INTERNAL-SUMMARY-SHOULD-NOT-LEAK",
      "INTERNAL-DIAGNOSIS-HINT-SHOULD-NOT-LEAK",
      "INTERNAL-DIAGNOSIS-EXPLANATION-SHOULD-NOT-LEAK",
    ];
    for (const sentinel of forbiddenSentinels) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("開示フィールドの値はそのまま透過する", () => {
    expect(out.user_facts.current_role).toBe("Software Engineer");
    expect(out.user_facts.years_of_experience).toBe(5);
    expect(out.user_facts.industry).toBe("Tech");
    expect(out.wants.industries).toEqual(["FinTech"]);
    expect(out.wants.role_types).toEqual(["Backend"]);
    expect(out.wants.company_sizes).toEqual(["1000名以上"]);
  });
});

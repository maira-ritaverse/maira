import { describe, expect, it } from "vitest";

import type { ExtractionResult } from "@/lib/career-intake/types";
import type { CareerProfile } from "@/lib/career/profile-schema";

import { buildSkeletonFromExtraction, mergeExtractionIntoProfile } from "./merge-from-extraction";

const emptyProfile: CareerProfile = {
  user_facts: {
    current_role: null,
    years_of_experience: null,
    industry: null,
    company_size: null,
  },
  strengths: [],
  values: [],
  wants: { industries: [], role_types: [], company_sizes: [] },
  concerns: [],
  summary: "",
};

const filledProfile: CareerProfile = {
  user_facts: {
    current_role: "バックエンドエンジニア",
    years_of_experience: 5,
    industry: "Web サービス",
    company_size: "100-500 名",
  },
  strengths: [{ label: "粘り強い", evidence: "...", category: "soft_skill" as const }],
  values: ["自己研鑽"],
  wants: { industries: ["IT"], role_types: ["バックエンド"], company_sizes: [] },
  concerns: ["転職経験少ない"],
  summary: "本人の言葉でまとめた既存プロフィール",
};

const emptyExtraction: ExtractionResult = {
  educationHistory: [],
  workHistory: [],
  licenses: [],
  workExperiences: [],
  skills: [],
  desiredIndustries: [],
  desiredOccupations: [],
  desiredLocations: [],
};

describe("mergeExtractionIntoProfile", () => {
  it("空の抽出結果は何も変更しない", () => {
    const { profile, preview } = mergeExtractionIntoProfile(filledProfile, emptyExtraction);
    expect(profile).toEqual(filledProfile);
    expect(preview.changedFields).toEqual([]);
  });

  it("希望業界は重複を排除して union 追加される", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      desiredIndustries: ["IT", "金融"],
    };
    const { profile, preview } = mergeExtractionIntoProfile(filledProfile, ext);
    expect(profile.wants.industries).toEqual(["IT", "金融"]);
    expect(preview.changedFields).toContain("希望業界");
  });

  it("既存の summary は AI 抽出で上書きされない", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      careerSummary: "AI が書いた要約(本人より弱い)",
    };
    const { profile, preview } = mergeExtractionIntoProfile(filledProfile, ext);
    expect(profile.summary).toBe("本人の言葉でまとめた既存プロフィール");
    expect(preview.changedFields).not.toContain("プロフィール総括");
  });

  it("空の summary なら careerSummary で初期化される", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      careerSummary: "AI が書いた要約",
    };
    const { profile, preview } = mergeExtractionIntoProfile(emptyProfile, ext);
    expect(profile.summary).toBe("AI が書いた要約");
    expect(preview.changedFields).toContain("プロフィール総括");
  });

  it("user_facts.current_role は既存があれば上書きしない", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      workExperiences: [
        {
          companyName: "X 社",
          position: "PdM",
          jobDescription: "",
          achievements: "",
        },
      ],
    };
    const { profile } = mergeExtractionIntoProfile(filledProfile, ext);
    // 既存「バックエンドエンジニア」が維持される
    expect(profile.user_facts.current_role).toBe("バックエンドエンジニア");
  });

  it("user_facts.current_role が null なら埋める", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      workExperiences: [
        {
          companyName: "X 社",
          position: "PdM",
          jobDescription: "",
          achievements: "",
        },
      ],
    };
    const { profile, preview } = mergeExtractionIntoProfile(emptyProfile, ext);
    expect(profile.user_facts.current_role).toBe("PdM");
    expect(preview.changedFields).toContain("現在の職種");
  });

  it("strengths / values / concerns には触らない", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      careerSummary: "abc",
      desiredIndustries: ["IT"],
    };
    const { profile } = mergeExtractionIntoProfile(filledProfile, ext);
    expect(profile.strengths).toEqual(filledProfile.strengths);
    expect(profile.values).toEqual(filledProfile.values);
    expect(profile.concerns).toEqual(filledProfile.concerns);
  });

  it("case 違い・前後空白は union で同じ要素とみなす", () => {
    const baseWants = {
      ...emptyProfile,
      wants: { industries: ["IT"], role_types: [], company_sizes: [] },
    };
    const ext: ExtractionResult = {
      ...emptyExtraction,
      desiredIndustries: [" it ", "ITサービス"],
    };
    const { profile } = mergeExtractionIntoProfile(baseWants, ext);
    expect(profile.wants.industries).toEqual(["IT", "ITサービス"]);
  });
});

describe("buildSkeletonFromExtraction", () => {
  it("空の抽出からも合法な CareerProfile を作る", () => {
    const p = buildSkeletonFromExtraction(emptyExtraction);
    expect(p.strengths).toEqual([]);
    expect(p.summary).toBe("");
  });

  it("workExperiences の先頭で current_role / industry を埋める", () => {
    const ext: ExtractionResult = {
      ...emptyExtraction,
      workExperiences: [
        {
          companyName: "X 社",
          industry: "Web",
          position: "Backend",
          jobDescription: "",
          achievements: "",
        },
      ],
      careerSummary: "概要",
      desiredIndustries: ["IT"],
    };
    const p = buildSkeletonFromExtraction(ext);
    expect(p.user_facts.current_role).toBe("Backend");
    expect(p.user_facts.industry).toBe("Web");
    expect(p.wants.industries).toEqual(["IT"]);
    expect(p.summary).toBe("概要");
  });
});

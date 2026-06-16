import { describe, expect, it } from "vitest";

import {
  aiRankingSchema,
  buildClientContextFromProfile,
  buildPrompt,
  computeInputsHash,
} from "./score";

const baseClient = {
  desired_annual_income: 600,
  desired_locations: ["東京"],
};

describe("buildClientContextFromProfile", () => {
  it("profile=null でもデフォルト値で返す", () => {
    const ctx = buildClientContextFromProfile(null, baseClient);
    expect(ctx.currentRole).toBeNull();
    expect(ctx.strengths).toEqual([]);
    expect(ctx.diagnosis).toBeNull();
    expect(ctx.desiredAnnualIncome).toBe(600);
  });

  it("diagnosis ありで axes / categories を変換する", () => {
    const ctx = buildClientContextFromProfile(
      {
        user_facts: {
          current_role: "PM",
          years_of_experience: 5,
          industry: "SaaS",
          company_size: null,
        },
        strengths: [{ label: "推進力", evidence: "x", category: "soft_skill" }],
        values: ["成長"],
        wants: { industries: ["IT"], role_types: ["PdM"], company_sizes: [] },
        concerns: [],
        summary: "PM 5 年。",
        diagnosis: {
          axis: { primary: "challenge", secondary: "autonomy", scores: anyAxisScores() },
          aptitude: { scores: anyAptitudeScores(), topStrengths: ["openness"] },
          jobs: { categories: [{ name: "PdM", description: "" }], aptitudeHint: "" },
          explanation: "",
          createdAt: "2026-06-01T00:00:00Z",
        },
      },
      baseClient,
    );
    expect(ctx.diagnosis?.primaryAxis).toBe("challenge");
    expect(ctx.diagnosis?.jobCategories).toEqual(["PdM"]);
    expect(ctx.strengths).toEqual(["推進力"]);
  });
});

describe("buildPrompt", () => {
  it("プロフィールと求人を含み、JSON フォーマット指示を末尾に持つ", () => {
    const p = buildPrompt({
      client: buildClientContextFromProfile(null, baseClient),
      jobs: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          organizationId: "o",
          companyName: "X 社",
          position: "PdM",
          employmentType: "正社員",
          location: "東京",
          salaryMin: 500,
          salaryMax: 700,
          description: "詳細",
          requiredSkills: null,
          preferredSkills: null,
          status: "open",
          workChangeScope: null,
          locationChangeScope: null,
          smokingPreventionMeasure: null,
          probationPeriod: null,
          workHours: null,
          breakTime: null,
          holidays: null,
          applicationQualifications: null,
          createdByMemberId: null,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    });
    expect(p).toContain("X 社");
    expect(p).toContain("PdM");
    expect(p).toContain('"job_posting_id"');
    expect(p).toContain("希望年収: 600");
  });
});

describe("computeInputsHash", () => {
  const base = {
    careerProfileUpdatedAt: "2026-06-15T00:00:00Z",
    clientUpdatedAt: "2026-06-15T00:00:00Z",
    jobs: [
      { id: "00000000-0000-0000-0000-000000000001", updated_at: "2026-06-01T00:00:00Z" },
      { id: "00000000-0000-0000-0000-000000000002", updated_at: "2026-06-02T00:00:00Z" },
    ],
  };

  it("同じ入力なら同じハッシュ", () => {
    expect(computeInputsHash(base)).toBe(computeInputsHash(base));
  });

  it("求人並びの順序差は吸収する", () => {
    const shuffled = { ...base, jobs: [...base.jobs].reverse() };
    expect(computeInputsHash(base)).toBe(computeInputsHash(shuffled));
  });

  it("プロフィール更新時刻が変わるとハッシュが変わる", () => {
    const next = { ...base, careerProfileUpdatedAt: "2026-06-16T00:00:00Z" };
    expect(computeInputsHash(base)).not.toBe(computeInputsHash(next));
  });

  it("求人の updated_at が変わるとハッシュが変わる", () => {
    const next = {
      ...base,
      jobs: [
        { id: "00000000-0000-0000-0000-000000000001", updated_at: "2026-06-09T00:00:00Z" },
        base.jobs[1],
      ],
    };
    expect(computeInputsHash(base)).not.toBe(computeInputsHash(next));
  });
});

describe("aiRankingSchema", () => {
  it("正常系", () => {
    const v = aiRankingSchema.safeParse({
      items: [
        {
          job_posting_id: "00000000-0000-0000-0000-000000000001",
          score: 87,
          rationale: "強みと診断結果が一致",
        },
      ],
    });
    expect(v.success).toBe(true);
  });

  it("score 範囲外は失敗", () => {
    const v = aiRankingSchema.safeParse({
      items: [
        { job_posting_id: "00000000-0000-0000-0000-000000000001", score: 200, rationale: "x" },
      ],
    });
    expect(v.success).toBe(false);
  });
});

function anyAxisScores() {
  return {
    specialist: 0,
    management: 0,
    autonomy: 0,
    security: 0,
    entrepreneur: 0,
    service: 0,
    challenge: 0,
    lifestyle: 0,
  };
}
function anyAptitudeScores() {
  return {
    openness: 0,
    conscientiousness: 0,
    extraversion: 0,
    agreeableness: 0,
    stability: 0,
  };
}

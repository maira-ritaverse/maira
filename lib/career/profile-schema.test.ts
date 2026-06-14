import { describe, it, expect } from "vitest";
import { careerProfileSchema, diagnosisSchema } from "./profile-schema";

/**
 * キャリア棚卸しスキーマのテスト。
 *
 * career_profile は暗号化されて保存されるユーザー所有データの中身。
 * AI 推論(Anthropic API)が返す JSON をここで検証してから DB に入れるので、
 * スキーマが緩いと AI の構造エラーが暗号化済みデータとして保存される事故が起こる。
 * 厳密な必須項目・enum・配列の境界を明示テストする。
 *
 * diagnosis は optional(段階的導入の互換性保持)。診断未実施の既存
 * career_profile が通ることを残しつつ、診断ありなら 8 軸の axisScores が
 * 完全に揃っている必要がある(欠けたキーで UI が落ちる事故の防止)。
 */

const minimalUserFacts = {
  current_role: null,
  years_of_experience: null,
  industry: null,
  company_size: null,
};

const minimalWants = {
  industries: [],
  role_types: [],
  company_sizes: [],
};

const baseProfile = {
  user_facts: minimalUserFacts,
  strengths: [],
  values: [],
  wants: minimalWants,
  concerns: [],
  summary: "総評テキスト",
};

describe("careerProfileSchema — 必須構造", () => {
  it("最小構成(全配列空、user_facts 全 null、wants 空)で通る", () => {
    expect(careerProfileSchema.safeParse(baseProfile).success).toBe(true);
  });

  it("user_facts は省略不可", () => {
    const without = { ...baseProfile } as Record<string, unknown>;
    delete without.user_facts;
    expect(careerProfileSchema.safeParse(without).success).toBe(false);
  });

  it("summary は省略不可(他モジュールが参照する総評)", () => {
    const without = { ...baseProfile } as Record<string, unknown>;
    delete without.summary;
    expect(careerProfileSchema.safeParse(without).success).toBe(false);
  });

  it("strengths は配列必須(個数 0 は OK)", () => {
    expect(careerProfileSchema.safeParse({ ...baseProfile, strengths: undefined }).success).toBe(
      false,
    );
    expect(careerProfileSchema.safeParse({ ...baseProfile, strengths: [] }).success).toBe(true);
  });
});

describe("careerProfileSchema — strengths のカテゴリ", () => {
  function strength(category: string) {
    return { label: "L", evidence: "E", category };
  }

  it("hard_skill / soft_skill / experience が許容される", () => {
    for (const c of ["hard_skill", "soft_skill", "experience"]) {
      expect(
        careerProfileSchema.safeParse({ ...baseProfile, strengths: [strength(c)] }).success,
      ).toBe(true);
    }
  });

  it("想定外の category は拒否(AI が雑な enum を返した場合の防御)", () => {
    expect(
      careerProfileSchema.safeParse({ ...baseProfile, strengths: [strength("unknown")] }).success,
    ).toBe(false);
    expect(
      careerProfileSchema.safeParse({ ...baseProfile, strengths: [strength("HARD_SKILL")] })
        .success,
    ).toBe(false); // 大文字違いも拒否
  });

  it("strength の label / evidence は文字列必須", () => {
    expect(
      careerProfileSchema.safeParse({
        ...baseProfile,
        strengths: [{ label: 1, evidence: "E", category: "hard_skill" }],
      }).success,
    ).toBe(false);
    expect(
      careerProfileSchema.safeParse({
        ...baseProfile,
        strengths: [{ label: "L", category: "hard_skill" }], // evidence 抜け
      }).success,
    ).toBe(false);
  });
});

describe("careerProfileSchema — diagnosis(optional)", () => {
  const validAxisScores = {
    specialist: 0.5,
    management: 0.5,
    autonomy: 0.5,
    security: 0.5,
    entrepreneur: 0.5,
    service: 0.5,
    challenge: 0.5,
    lifestyle: 0.5,
  };

  const validAptitudeScores = {
    openness: 0.5,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    stability: 0.5,
  };

  const validDiagnosis = {
    axis: {
      primary: "specialist",
      secondary: "management",
      scores: validAxisScores,
    },
    aptitude: {
      scores: validAptitudeScores,
      topStrengths: ["openness", "conscientiousness"],
    },
    jobs: {
      categories: [{ name: "PM", description: "..." }],
      aptitudeHint: "ヒント文",
    },
    explanation: "解説",
    createdAt: "2026-06-14T00:00:00.000Z",
  };

  it("diagnosis 無しでも通る(段階導入の互換性)", () => {
    expect(careerProfileSchema.safeParse(baseProfile).success).toBe(true);
  });

  it("正しい diagnosis ありで通る", () => {
    expect(
      careerProfileSchema.safeParse({ ...baseProfile, diagnosis: validDiagnosis }).success,
    ).toBe(true);
  });

  it("axis.secondary は null 許容(2 軸目なしのケース)", () => {
    const d = { ...validDiagnosis, axis: { ...validDiagnosis.axis, secondary: null } };
    expect(careerProfileSchema.safeParse({ ...baseProfile, diagnosis: d }).success).toBe(true);
  });

  it("axisScores の 8 種が 1 つでも欠けると失敗(UI 落ち防止)", () => {
    const partialScores = { ...validAxisScores } as Record<string, number>;
    delete partialScores.lifestyle;
    const d = { ...validDiagnosis, axis: { ...validDiagnosis.axis, scores: partialScores } };
    expect(careerProfileSchema.safeParse({ ...baseProfile, diagnosis: d }).success).toBe(false);
  });

  it("aptitudeScores の 5 種が 1 つでも欠けると失敗", () => {
    const partial = { ...validAptitudeScores } as Record<string, number>;
    delete partial.stability;
    const d = { ...validDiagnosis, aptitude: { ...validDiagnosis.aptitude, scores: partial } };
    expect(careerProfileSchema.safeParse({ ...baseProfile, diagnosis: d }).success).toBe(false);
  });

  it("axis.primary が enum 外なら失敗", () => {
    const d = { ...validDiagnosis, axis: { ...validDiagnosis.axis, primary: "unknown" } };
    expect(careerProfileSchema.safeParse({ ...baseProfile, diagnosis: d }).success).toBe(false);
  });

  it("topStrengths は最大 5 件(6 件目で失敗)", () => {
    const d = {
      ...validDiagnosis,
      aptitude: {
        ...validDiagnosis.aptitude,
        // 5 種 + 1 重複 = 6 件で max 5 を超える
        topStrengths: [
          "openness",
          "conscientiousness",
          "extraversion",
          "agreeableness",
          "stability",
          "openness",
        ],
      },
    };
    expect(careerProfileSchema.safeParse({ ...baseProfile, diagnosis: d }).success).toBe(false);
  });
});

describe("diagnosisSchema を直接使う", () => {
  it("careerProfile.diagnosis と同じ構造を独立して parse できる", () => {
    const valid = {
      axis: {
        primary: "challenge",
        secondary: null,
        scores: {
          specialist: 0,
          management: 0,
          autonomy: 0,
          security: 0,
          entrepreneur: 0,
          service: 0,
          challenge: 1,
          lifestyle: 0,
        },
      },
      aptitude: {
        scores: {
          openness: 1,
          conscientiousness: 0,
          extraversion: 0,
          agreeableness: 0,
          stability: 0,
        },
        topStrengths: [],
      },
      jobs: { categories: [], aptitudeHint: "" },
      explanation: "",
      createdAt: "2026-06-14T00:00:00Z",
    };
    expect(diagnosisSchema.safeParse(valid).success).toBe(true);
  });
});

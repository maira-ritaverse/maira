import { describe, expect, it } from "vitest";
import {
  cvBodySchema,
  emptyCvBody,
  employmentTypeLabels,
  employmentTypes,
  periodPointSchema,
  saveCvRequestSchema,
  skillCategories,
  skillCategoryLabels,
  skillLevelLabels,
  skillLevels,
  skillSchema,
  workExperienceSchema,
  type EmploymentType,
  type SkillCategory,
  type SkillLevel,
} from "./types";

/**
 * 職務経歴書スキーマの最低限の検証テスト。
 *
 * 目的:
 * - 「下書き保存(空文字許可)」と「事実は必須」の境界が崩れないように固定する
 * - 履歴書と違って職務経歴書は事実(会社名)を必須にしている点を担保
 */

describe("workExperienceSchema", () => {
  it("会社名のみ入力で他は null/空でも通る(下書き保存可)", () => {
    const parsed = workExperienceSchema.safeParse({
      company_name: "○○株式会社",
      industry: null,
      period_start: null,
      period_end: null,
      position: null,
      employment_type: null,
      job_description: "",
      achievements: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("会社名が空だと弾く(事実は必須)", () => {
    const parsed = workExperienceSchema.safeParse({
      company_name: "",
      industry: null,
      period_start: null,
      period_end: null,
      position: null,
      employment_type: null,
      job_description: "",
      achievements: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("期間は year/month 両方必須(片方だけは NG)", () => {
    const parsed = workExperienceSchema.safeParse({
      company_name: "○○株式会社",
      industry: null,
      // year だけ入っている = NG
      period_start: { year: 2020 },
      period_end: null,
      position: null,
      employment_type: null,
      job_description: "",
      achievements: "",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("skillSchema", () => {
  it("category と name が揃えば通る", () => {
    const parsed = skillSchema.safeParse({
      category: "language",
      name: "TypeScript",
      level: null,
      description: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("name が空だと弾く(空のスキル行を保存させない)", () => {
    const parsed = skillSchema.safeParse({
      category: "language",
      name: "",
      level: null,
      description: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("cvBodySchema", () => {
  it("空の CvBody が通る(新規作成直後の状態)", () => {
    const parsed = cvBodySchema.safeParse(emptyCvBody());
    expect(parsed.success).toBe(true);
  });

  it("summary/self_pr が空文字でも通る(下書き保存可)", () => {
    const parsed = cvBodySchema.safeParse({
      summary: "",
      work_experiences: [
        {
          company_name: "前職",
          industry: null,
          period_start: null,
          period_end: null,
          position: null,
          employment_type: null,
          job_description: "",
          achievements: "",
        },
      ],
      skills: [],
      self_pr: "",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("saveCvRequestSchema", () => {
  it("title だけ入っていれば通る(下書き保存可)", () => {
    const parsed = saveCvRequestSchema.safeParse({
      title: "汎用版",
      body: emptyCvBody(),
    });
    expect(parsed.success).toBe(true);
  });

  it("title が空だと弾く", () => {
    const parsed = saveCvRequestSchema.safeParse({
      title: "",
      body: emptyCvBody(),
    });
    expect(parsed.success).toBe(false);
  });

  it("license_resume_id は uuid のみ受ける", () => {
    const ok = saveCvRequestSchema.safeParse({
      title: "汎用版",
      license_resume_id: "11111111-1111-1111-1111-111111111111",
      body: emptyCvBody(),
    });
    expect(ok.success).toBe(true);

    const ng = saveCvRequestSchema.safeParse({
      title: "汎用版",
      license_resume_id: "not-a-uuid",
      body: emptyCvBody(),
    });
    expect(ng.success).toBe(false);
  });

  it("license_resume_id は null も省略も OK", () => {
    const a = saveCvRequestSchema.safeParse({
      title: "汎用版",
      license_resume_id: null,
      body: emptyCvBody(),
    });
    expect(a.success).toBe(true);

    const b = saveCvRequestSchema.safeParse({
      title: "汎用版",
      body: emptyCvBody(),
    });
    expect(b.success).toBe(true);
  });
});

// ====================================================================
// 以下は追加カバレッジ:enum 対応 / 期間 refine / 文字数境界 / 構造保証
// ====================================================================

const ALL_EMPLOYMENT: EmploymentType[] = ["full_time", "contract", "part_time", "other"];
const ALL_SKILL_CATEGORIES: SkillCategory[] = [
  "language",
  "framework",
  "tool",
  "soft_skill",
  "domain",
  "other",
];
const ALL_SKILL_LEVELS: SkillLevel[] = ["basic", "intermediate", "advanced"];

describe("ラベル定義と enum の対応", () => {
  it("employmentTypes と employmentTypeLabels のキーが一致", () => {
    expect(employmentTypes).toEqual(ALL_EMPLOYMENT);
    expect(Object.keys(employmentTypeLabels).sort()).toEqual([...ALL_EMPLOYMENT].sort());
  });

  it("skillCategories と skillCategoryLabels のキーが一致(6 種)", () => {
    expect(skillCategories).toEqual(ALL_SKILL_CATEGORIES);
    expect(Object.keys(skillCategoryLabels).sort()).toEqual([...ALL_SKILL_CATEGORIES].sort());
  });

  it("skillLevels と skillLevelLabels のキーが一致(3 種)", () => {
    expect(skillLevels).toEqual(ALL_SKILL_LEVELS);
    expect(Object.keys(skillLevelLabels).sort()).toEqual([...ALL_SKILL_LEVELS].sort());
  });
});

describe("periodPointSchema", () => {
  it("year 1950〜2100 / month 1〜12 で通る", () => {
    expect(periodPointSchema.safeParse({ year: 1950, month: 1 }).success).toBe(true);
    expect(periodPointSchema.safeParse({ year: 2100, month: 12 }).success).toBe(true);
  });

  it("範囲外を拒否(year 1949 / 2101、month 0 / 13)", () => {
    expect(periodPointSchema.safeParse({ year: 1949, month: 6 }).success).toBe(false);
    expect(periodPointSchema.safeParse({ year: 2101, month: 6 }).success).toBe(false);
    expect(periodPointSchema.safeParse({ year: 2025, month: 0 }).success).toBe(false);
    expect(periodPointSchema.safeParse({ year: 2025, month: 13 }).success).toBe(false);
  });

  it("小数は拒否(整数のみ)", () => {
    expect(periodPointSchema.safeParse({ year: 2025.5, month: 1 }).success).toBe(false);
    expect(periodPointSchema.safeParse({ year: 2025, month: 6.5 }).success).toBe(false);
  });
});

describe("workExperienceSchema — 期間 refine(片方 null はスキップ)", () => {
  function withPeriod(start: unknown, end: unknown) {
    return {
      company_name: "X",
      industry: null,
      period_start: start,
      period_end: end,
      position: null,
      employment_type: null,
      job_description: "",
      achievements: "",
    };
  }

  it("退社が入社より後なら通る", () => {
    expect(
      workExperienceSchema.safeParse(withPeriod({ year: 2020, month: 4 }, { year: 2024, month: 3 }))
        .success,
    ).toBe(true);
  });

  it("同月(退社=入社)も通る(短期間在籍を許容)", () => {
    expect(
      workExperienceSchema.safeParse(withPeriod({ year: 2020, month: 4 }, { year: 2020, month: 4 }))
        .success,
    ).toBe(true);
  });

  it("退社が入社より前なら refine で失敗(エラーパスは period_end)", () => {
    const r = workExperienceSchema.safeParse(
      withPeriod({ year: 2024, month: 3 }, { year: 2020, month: 4 }),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("period_end"));
      expect(issue?.message).toContain("入社年月");
    }
  });

  it("period_end=null(在籍中)は前後チェックをスキップして通る", () => {
    expect(workExperienceSchema.safeParse(withPeriod({ year: 2020, month: 4 }, null)).success).toBe(
      true,
    );
  });

  it("period_start=null(開始未入力)もスキップ", () => {
    expect(workExperienceSchema.safeParse(withPeriod(null, { year: 2024, month: 3 })).success).toBe(
      true,
    );
  });

  it("両方 null(完全な下書き)もスキップ", () => {
    expect(workExperienceSchema.safeParse(withPeriod(null, null)).success).toBe(true);
  });
});

describe("workExperienceSchema — 文字数境界", () => {
  function base(overrides: Record<string, unknown> = {}) {
    return {
      company_name: "X",
      industry: null,
      period_start: null,
      period_end: null,
      position: null,
      employment_type: null,
      job_description: "",
      achievements: "",
      ...overrides,
    };
  }

  it("company_name 200 文字境界", () => {
    expect(workExperienceSchema.safeParse(base({ company_name: "a".repeat(200) })).success).toBe(
      true,
    );
    expect(workExperienceSchema.safeParse(base({ company_name: "a".repeat(201) })).success).toBe(
      false,
    );
  });

  it("industry 100 文字 / position 200 文字境界", () => {
    expect(workExperienceSchema.safeParse(base({ industry: "a".repeat(101) })).success).toBe(false);
    expect(workExperienceSchema.safeParse(base({ position: "a".repeat(201) })).success).toBe(false);
  });

  it("job_description / achievements は 2000 文字境界(空 OK)", () => {
    expect(
      workExperienceSchema.safeParse(base({ job_description: "a".repeat(2000) })).success,
    ).toBe(true);
    expect(
      workExperienceSchema.safeParse(base({ job_description: "a".repeat(2001) })).success,
    ).toBe(false);
    expect(workExperienceSchema.safeParse(base({ achievements: "a".repeat(2001) })).success).toBe(
      false,
    );
  });

  it("employment_type は ALL_EMPLOYMENT のみ", () => {
    for (const t of ALL_EMPLOYMENT) {
      expect(workExperienceSchema.safeParse(base({ employment_type: t })).success).toBe(true);
    }
    expect(workExperienceSchema.safeParse(base({ employment_type: "freelance" })).success).toBe(
      false,
    );
  });
});

describe("skillSchema — enum と境界", () => {
  it("category enum 外は拒否(6 種以外)", () => {
    expect(
      skillSchema.safeParse({
        category: "unknown",
        name: "x",
        level: null,
        description: null,
      }).success,
    ).toBe(false);
  });

  it("level は 'basic' / 'intermediate' / 'advanced' / null のみ", () => {
    for (const l of ALL_SKILL_LEVELS) {
      expect(
        skillSchema.safeParse({ category: "language", name: "x", level: l, description: null })
          .success,
      ).toBe(true);
    }
    expect(
      skillSchema.safeParse({
        category: "language",
        name: "x",
        level: "expert",
        description: null,
      }).success,
    ).toBe(false);
  });

  it("name 100 文字境界 / description 500 文字境界", () => {
    expect(
      skillSchema.safeParse({
        category: "language",
        name: "a".repeat(100),
        level: null,
        description: null,
      }).success,
    ).toBe(true);
    expect(
      skillSchema.safeParse({
        category: "language",
        name: "a".repeat(101),
        level: null,
        description: null,
      }).success,
    ).toBe(false);
    expect(
      skillSchema.safeParse({
        category: "language",
        name: "x",
        level: null,
        description: "a".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("cvBodySchema — 文字数境界", () => {
  it("summary は 1500 文字境界", () => {
    expect(
      cvBodySchema.safeParse({
        summary: "a".repeat(1500),
        work_experiences: [],
        skills: [],
        self_pr: "",
      }).success,
    ).toBe(true);
    expect(
      cvBodySchema.safeParse({
        summary: "a".repeat(1501),
        work_experiences: [],
        skills: [],
        self_pr: "",
      }).success,
    ).toBe(false);
  });

  it("self_pr は 2000 文字境界", () => {
    expect(
      cvBodySchema.safeParse({
        summary: "",
        work_experiences: [],
        skills: [],
        self_pr: "a".repeat(2000),
      }).success,
    ).toBe(true);
    expect(
      cvBodySchema.safeParse({
        summary: "",
        work_experiences: [],
        skills: [],
        self_pr: "a".repeat(2001),
      }).success,
    ).toBe(false);
  });
});

describe("emptyCvBody — 新規作成時の参照共有防止", () => {
  it("呼び出すたびに新しいオブジェクトを返す(参照を共有しない)", () => {
    const a = emptyCvBody();
    const b = emptyCvBody();
    expect(a).not.toBe(b);
    // 配列も別参照(片方を push しても他方に波及しない)
    expect(a.work_experiences).not.toBe(b.work_experiences);
    expect(a.skills).not.toBe(b.skills);
  });

  it("cvBodySchema を満たす(スキーマ変更時の互換性検知)", () => {
    expect(cvBodySchema.safeParse(emptyCvBody()).success).toBe(true);
  });
});

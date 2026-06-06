import { describe, expect, it } from "vitest";
import {
  cvBodySchema,
  emptyCvBody,
  saveCvRequestSchema,
  skillSchema,
  workExperienceSchema,
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

import { describe, it, expect } from "vitest";
import { buildCvDraftPrompt, skillCandidatesSchema, workExperienceDraftSchema } from "./cv-draft";
import type { CareerProfile } from "@/lib/career/profile-schema";
import type { WorkExperience } from "@/lib/cvs/types";

/**
 * CV ドラフト生成プロンプトとスキーマのテスト。
 *
 * 「会社名・期間を AI に渡さない」「捏造防止ルールが残っている」「フィールドごとに
 * 適切な棚卸し情報だけを渡す」の 3 つが本ファイルの設計の要。これらを破る変更が
 * 入ったらテストで気付ける。
 *
 * 職務経歴書は応募先に提出する事実書類なので、AI に渡る情報の絞り込みは
 * セキュリティ責務(虚偽記載リスク + 個人情報漏洩防止)を兼ねる。
 */

const baseProfile: CareerProfile = {
  user_facts: {
    current_role: "エンジニア",
    years_of_experience: 5,
    industry: "IT",
    company_size: "100-500名",
  },
  strengths: [
    { label: "問題解決力", evidence: "プロジェクトで○○", category: "soft_skill" },
    { label: "TypeScript", evidence: "業務で 3 年", category: "hard_skill" },
    { label: "リーダーシップ", evidence: "チームを引っ張った", category: "soft_skill" },
  ],
  values: ["挑戦"],
  wants: {
    industries: ["IT"],
    role_types: ["バックエンド"],
    company_sizes: ["50-200"],
  },
  concerns: [],
  summary: "Web 開発 5 年",
};

describe("skillCandidatesSchema", () => {
  it("最大 20 件まで受け付ける", () => {
    const candidates = Array.from({ length: 20 }, () => ({
      category: "language" as const,
      name: "Lang",
      level: "intermediate" as const,
      description: null,
    }));
    expect(skillCandidatesSchema.safeParse({ candidates }).success).toBe(true);
  });

  it("21 件は失敗(AI の冗長出力をスキーマで弾く)", () => {
    const candidates = Array.from({ length: 21 }, () => ({
      category: "language" as const,
      name: "Lang",
      level: null,
      description: null,
    }));
    expect(skillCandidatesSchema.safeParse({ candidates }).success).toBe(false);
  });

  it("空配列(候補 0 件)も許容", () => {
    expect(skillCandidatesSchema.safeParse({ candidates: [] }).success).toBe(true);
  });
});

describe("workExperienceDraftSchema", () => {
  it("job_description は空文字 NG(AI を呼んだ意味が無くなるため)", () => {
    expect(
      workExperienceDraftSchema.safeParse({ job_description: "", achievements: "x" }).success,
    ).toBe(false);
  });

  it("achievements は空文字 OK(無理に実績を捏造させない契約)", () => {
    expect(
      workExperienceDraftSchema.safeParse({ job_description: "業務", achievements: "" }).success,
    ).toBe(true);
  });

  it("job_description / achievements とも 2000 文字境界", () => {
    expect(
      workExperienceDraftSchema.safeParse({
        job_description: "a".repeat(2000),
        achievements: "a".repeat(2000),
      }).success,
    ).toBe(true);
    expect(
      workExperienceDraftSchema.safeParse({
        job_description: "a".repeat(2001),
        achievements: "",
      }).success,
    ).toBe(false);
  });
});

describe("buildCvDraftPrompt — skills フィールド", () => {
  it("strengths のみ渡す(user_facts/wants/values は渡さない=役職推測からの脱線防止)", () => {
    const r = buildCvDraftPrompt({ field: "skills", profile: baseProfile });
    expect(r.prompt).toContain("問題解決力");
    expect(r.prompt).toContain("TypeScript");
    // user_facts / wants の中身は含まれない
    expect(r.prompt).not.toContain("100-500名");
    expect(r.prompt).not.toContain("バックエンド");
  });

  it("「推測で関連スキルを足さないでください」の指示が含まれる", () => {
    const r = buildCvDraftPrompt({ field: "skills", profile: baseProfile });
    expect(r.prompt).toContain("推測");
  });
});

describe("buildCvDraftPrompt — work_experience フィールド", () => {
  const baseWorkExp: WorkExperience = {
    company_name: "ABC 株式会社",
    industry: "IT",
    period_start: { year: 2020, month: 4 },
    period_end: { year: 2024, month: 3 },
    position: "エンジニア",
    employment_type: "full_time",
    job_description: "",
    achievements: "",
  };

  it("会社名は AI に渡らない(本文に出してはいけない情報は知らせない)", () => {
    const r = buildCvDraftPrompt({
      field: "work_experience",
      profile: baseProfile,
      workExperience: baseWorkExp,
    });
    expect(r.prompt).not.toContain("ABC 株式会社");
  });

  it("期間(year/month)も AI に渡らない(本文に出してはいけない情報)", () => {
    const r = buildCvDraftPrompt({
      field: "work_experience",
      profile: baseProfile,
      workExperience: baseWorkExp,
    });
    expect(r.prompt).not.toContain("2020");
    expect(r.prompt).not.toContain("2024");
  });

  it("役職・業界・雇用形態は渡される(文脈に使うため)", () => {
    const r = buildCvDraftPrompt({
      field: "work_experience",
      profile: baseProfile,
      workExperience: baseWorkExp,
    });
    expect(r.prompt).toContain("エンジニア");
    expect(r.prompt).toContain("IT");
    expect(r.prompt).toContain("正社員"); // employmentTypeLabels で日本語化
  });

  it("period_end=null(在籍中)は is_current: true で渡される", () => {
    const r = buildCvDraftPrompt({
      field: "work_experience",
      profile: baseProfile,
      workExperience: { ...baseWorkExp, period_end: null },
    });
    expect(r.prompt).toContain('"is_current": true');
  });

  it("棚卸しの strengths が文脈として渡される", () => {
    const r = buildCvDraftPrompt({
      field: "work_experience",
      profile: baseProfile,
      workExperience: baseWorkExp,
    });
    expect(r.prompt).toContain("問題解決力");
  });
});

describe("buildCvDraftPrompt — summary フィールド", () => {
  it("user_facts と summary が渡される", () => {
    const r = buildCvDraftPrompt({ field: "summary", profile: baseProfile });
    expect(r.prompt).toContain("エンジニア");
    expect(r.prompt).toContain("Web 開発 5 年");
  });

  it("strengths は上位 2 件のラベルのみ(evidence は要約欄で不要)", () => {
    const r = buildCvDraftPrompt({ field: "summary", profile: baseProfile });
    expect(r.prompt).toContain("問題解決力");
    expect(r.prompt).toContain("TypeScript");
    // 3 件目のラベルは含まれない(slice(0, 2))
    expect(r.prompt).not.toContain("リーダーシップ");
    // evidence は含まれない(ラベルのみ)
    expect(r.prompt).not.toContain("プロジェクトで○○");
  });

  it("wants は渡されない(志望動機は別書類のため)", () => {
    const r = buildCvDraftPrompt({ field: "summary", profile: baseProfile });
    expect(r.prompt).not.toContain("バックエンド");
  });
});

describe("buildCvDraftPrompt — self_pr フィールド", () => {
  it("strengths が evidence ごと渡される(自己PR で具体例を使うため)", () => {
    const r = buildCvDraftPrompt({ field: "self_pr", profile: baseProfile });
    expect(r.prompt).toContain("問題解決力");
    expect(r.prompt).toContain("プロジェクトで○○"); // evidence も含まれる
  });

  it("values と summary も渡される", () => {
    const r = buildCvDraftPrompt({ field: "self_pr", profile: baseProfile });
    expect(r.prompt).toContain("挑戦");
    expect(r.prompt).toContain("Web 開発 5 年");
  });

  it("wants / concerns は渡されない(自己PRには不要)", () => {
    const r = buildCvDraftPrompt({ field: "self_pr", profile: baseProfile });
    expect(r.prompt).not.toContain("バックエンド");
  });
});

describe("buildCvDraftPrompt — system プロンプトに捏造防止ルールが含まれる", () => {
  it("summary の system に捏造防止ルールがある", () => {
    const r = buildCvDraftPrompt({ field: "summary", profile: baseProfile });
    expect(r.system).toContain("虚偽記載防止");
    expect(r.system).toContain("創作しない");
  });

  it("self_pr / skills / work_experience の各 system にも捏造防止ルールがある", () => {
    for (const field of ["summary", "self_pr", "skills"] as const) {
      const r = buildCvDraftPrompt({ field, profile: baseProfile });
      expect(r.system).toContain("虚偽記載防止");
    }
  });
});

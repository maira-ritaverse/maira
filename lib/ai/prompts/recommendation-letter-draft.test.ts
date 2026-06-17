import { describe, expect, it } from "vitest";

import type { CareerProfile } from "@/lib/career/profile-schema";

import {
  buildRecommendationLetterDraftPrompt,
  splitRecommendationLetterOutput,
  type RecommendationLetterPromptJob,
} from "./recommendation-letter-draft";

/**
 * 推薦文ドラフトプロンプトの契約テスト。
 *
 * 推薦状は採用判断に使われる公式文書 → 虚偽記載防止ルールが system に
 * 残っていることをテストで保証する(将来うっかり外されないように)。
 *
 * テストの観点:
 *   1. summary / strengths / values / wants が prompt に含まれる
 *   2. user_facts(会社規模・年齢相当)は渡さない(個人情報流入防止)
 *   3. job 情報(company_name, position, required_skills, description, preferred_skills)が含まれる
 *   4. system に「虚偽記載防止」「件名:」出力ルールが残っている
 *   5. splitRecommendationLetterOutput が headline と body を正しく分離する
 */

const baseProfile: CareerProfile = {
  user_facts: {
    current_role: "プロダクトマネージャー",
    years_of_experience: 6,
    industry: "SaaS",
    company_size: "100-500名",
  },
  strengths: [
    {
      label: "ユーザー視点の機能設計",
      evidence: "○○社で機能要望整理を主導",
      category: "soft_skill",
    },
  ],
  values: ["顧客第一"],
  wants: {
    industries: ["SaaS"],
    role_types: ["プロダクトマネージャー"],
    company_sizes: ["200-1000"],
  },
  concerns: ["大企業特有の意思決定スピード"],
  summary: "SaaS の機能企画 6 年。要望整理から計測まで一気通貫で担当。",
};

const baseJob: RecommendationLetterPromptJob = {
  companyName: "株式会社サンプル",
  position: "プロダクトマネージャー",
  description: "新規プロダクトの仮説検証を中心に担当します。",
  requiredSkills: "プロダクト企画、データ分析、要件定義",
  preferredSkills: "BtoB SaaS の経験",
};

describe("buildRecommendationLetterDraftPrompt", () => {
  it("system と prompt の 2 つを返す", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.system.length).toBeGreaterThan(0);
    expect(r.prompt.length).toBeGreaterThan(0);
  });

  it("候補者の summary / strengths / values / wants が prompt に含まれる", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.prompt).toContain("SaaS の機能企画 6 年");
    expect(r.prompt).toContain("ユーザー視点の機能設計");
    expect(r.prompt).toContain("顧客第一");
    expect(r.prompt).toContain("プロダクトマネージャー");
  });

  it("user_facts(会社規模)と concerns(不安)を prompt に渡さない", () => {
    // 個人属性の流入や、ネガティブな表現の引っ張られ防止
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.prompt).not.toContain("100-500名");
    expect(r.prompt).not.toContain("大企業特有の意思決定スピード");
  });

  it("求人情報の company_name / position / required_skills が prompt に含まれる", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.prompt).toContain("株式会社サンプル");
    expect(r.prompt).toContain("プロダクトマネージャー");
    expect(r.prompt).toContain("プロダクト企画、データ分析、要件定義");
  });

  it("advisorNotes は null のとき「(特になし)」と書く(空欄で AI が混乱しないように)", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.prompt).toContain("(特になし)");
  });

  it("advisorNotes が指定された場合は prompt に含まれる", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: "面談での印象は非常に良く、即戦力として期待できる。",
    });
    expect(r.prompt).toContain("即戦力として期待できる");
  });

  it("system に虚偽記載防止ルールが残っている(契約テスト)", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.system).toContain("虚偽記載防止");
    // 主要な禁止項目
    expect(r.system).toContain("資格名");
    expect(r.system).toContain("捏造");
    expect(r.system).toContain("受賞歴・表彰歴を創作しない");
  });

  it("system に「件名:」を 1 行目に出す出力ルールが残っている", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.system).toContain("件名:");
  });

  it("system にテンプレ(prefix/suffix)は含まれない(連結はレンダリング層)", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.system).toContain("テンプレ");
    expect(r.system).toContain("本下書きに含めない");
  });

  it("system に「貴社」「弊社」の役割設定が残っている", () => {
    const r = buildRecommendationLetterDraftPrompt({
      profile: baseProfile,
      jobPosting: baseJob,
      advisorNotes: null,
    });
    expect(r.system).toContain("弊社");
    expect(r.system).toContain("貴社");
  });
});

describe("splitRecommendationLetterOutput", () => {
  it("「件名: ...」が 1 行目にあるとき headline と body に分離する", () => {
    const raw = `件名: 山田様(プロダクトマネージャー職)推薦の件

拝啓 時下ますますご清祥のこととお慶び申し上げます。
…(本文)…
敬具`;
    const r = splitRecommendationLetterOutput(raw);
    expect(r.headline).toBe("山田様(プロダクトマネージャー職)推薦の件");
    expect(r.body.startsWith("拝啓")).toBe(true);
    expect(r.body).toContain("敬具");
  });

  it("件名が無いときは headline 空文字、body は全文(フェイルオープン)", () => {
    const raw = `拝啓
本文だけ
敬具`;
    const r = splitRecommendationLetterOutput(raw);
    expect(r.headline).toBe("");
    expect(r.body).toContain("拝啓");
  });

  it("全角コロンでも分離できる(モデルが全角を返す可能性に対応)", () => {
    const raw = `件名: 推薦の件

拝啓 …
敬具`;
    const r = splitRecommendationLetterOutput(raw);
    expect(r.headline).toBe("推薦の件");
    expect(r.body.startsWith("拝啓")).toBe(true);
  });
});

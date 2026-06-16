import { describe, expect, it } from "vitest";

import { buildJobTailoredPrPrompt, jobTailoredPrSchema } from "./job-tailored-pr";
import type { CareerProfile } from "@/lib/career/profile-schema";

// テスト用のミニマム CareerProfile(必須フィールドだけ埋める)
const baseProfile: CareerProfile = {
  user_facts: {
    current_role: "Webディレクター",
    years_of_experience: 3,
    industry: "SaaS",
    company_size: "100-300名",
  },
  summary: "Web ディレクターとして SaaS 開発に従事。",
  strengths: [
    {
      label: "ユーザー視点の機能設計",
      evidence: "前職で 5 件の新機能の要件定義をリード。",
      category: "soft_skill",
    },
  ],
  values: ["ユーザーへの誠実さ"],
  wants: { industries: [], role_types: [], company_sizes: [] },
  concerns: [],
};

const baseJob = {
  company: "サンプル株式会社",
  position: "プロダクトマネージャー",
};

describe("buildJobTailoredPrPrompt", () => {
  it("system プロンプトに 3 つの出力枠が明示されている", () => {
    const { system } = buildJobTailoredPrPrompt({ profile: baseProfile, job: baseJob });
    expect(system).toContain("resume_self_pr");
    expect(system).toContain("cv_self_pr");
    expect(system).toContain("motivation_note");
  });

  it("user prompt に棚卸し結果 / 求人情報 / ベース文書が含まれる", () => {
    const { prompt } = buildJobTailoredPrPrompt({
      profile: baseProfile,
      job: { ...baseJob, notes: "Web SaaS の PM ポジション" },
      base: { baseResumeSelfPr: "既存の履歴書 PR" },
    });
    expect(prompt).toContain("【A. 棚卸し結果】");
    expect(prompt).toContain("【B. 応募する求人】");
    expect(prompt).toContain("【C. ベース文書(任意・参考)】");
    expect(prompt).toContain("サンプル株式会社");
    expect(prompt).toContain("プロダクトマネージャー");
    expect(prompt).toContain("Web SaaS の PM ポジション");
    expect(prompt).toContain("既存の履歴書 PR");
  });

  it("ベース文書が無い場合は全 null として渡る(ゼロから生成可能)", () => {
    const { prompt } = buildJobTailoredPrPrompt({ profile: baseProfile, job: baseJob });
    // JSON.stringify では null は文字列 "null" になる
    expect(prompt).toMatch(/"resume_self_pr":\s*null/);
    expect(prompt).toMatch(/"cv_self_pr":\s*null/);
    expect(prompt).toMatch(/"motivation_note":\s*null/);
  });

  it("jdExtra(UI で貼り付けた JD)が prompt に反映される", () => {
    const { prompt } = buildJobTailoredPrPrompt({
      profile: baseProfile,
      job: { ...baseJob, jdExtra: "詳細 JD 全文をここに貼った内容" },
    });
    expect(prompt).toContain("詳細 JD 全文をここに貼った内容");
    expect(prompt).toContain("jd_extra");
  });

  it("system プロンプトに自画自賛 / 捏造の禁止ルールがある", () => {
    const { system } = buildJobTailoredPrPrompt({ profile: baseProfile, job: baseJob });
    expect(system).toMatch(/自画自賛|素晴らしい/);
    expect(system).toMatch(/捏造|盛らない/);
    expect(system).toContain("マークダウン記法");
  });
});

describe("jobTailoredPrSchema", () => {
  it("3 フィールドすべて埋まった出力を受け入れる", () => {
    const ok = jobTailoredPrSchema.safeParse({
      resume_self_pr: "あ".repeat(300),
      cv_self_pr: "い".repeat(400),
      motivation_note: "う".repeat(350),
    });
    expect(ok.success).toBe(true);
  });

  it("どれかが空文字だと弾く(min(50))", () => {
    const bad = jobTailoredPrSchema.safeParse({
      resume_self_pr: "",
      cv_self_pr: "い".repeat(400),
      motivation_note: "う".repeat(350),
    });
    expect(bad.success).toBe(false);
  });

  it("上限超過(3000 字超)を弾く", () => {
    const bad = jobTailoredPrSchema.safeParse({
      resume_self_pr: "あ".repeat(3001),
      cv_self_pr: "い".repeat(400),
      motivation_note: "う".repeat(350),
    });
    expect(bad.success).toBe(false);
  });
});

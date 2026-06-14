import { describe, it, expect } from "vitest";
import { buildResumeDraftPrompt } from "./resume-draft";
import type { CareerProfile } from "@/lib/career/profile-schema";

/**
 * 履歴書ドラフトプロンプトの境界テスト。
 *
 * cv-draft と同じ「フィールドごとに必要最小限の情報だけ渡す」設計。
 * - motivation: strengths / values / wants(志望動機の文脈)
 * - personal_requests: wants のみ(他は脱線防止のため渡さない)
 *
 * 履歴書も応募先に提出する事実書類なので、ANTI_FABRICATION_RULES が system に
 * 残っていることをテストで担保する。
 */

const baseProfile: CareerProfile = {
  user_facts: {
    current_role: "エンジニア",
    years_of_experience: 5,
    industry: "IT",
    company_size: "100-500名",
  },
  strengths: [{ label: "TypeScript", evidence: "業務 3 年", category: "hard_skill" }],
  values: ["挑戦"],
  wants: {
    industries: ["IT"],
    role_types: ["バックエンド"],
    company_sizes: ["50-200"],
  },
  concerns: ["将来の不安"],
  summary: "Web 開発 5 年",
};

describe("buildResumeDraftPrompt — motivation フィールド", () => {
  it("system + prompt の 2 つを返す", () => {
    const r = buildResumeDraftPrompt({ field: "motivation", profile: baseProfile });
    expect(r.system.length).toBeGreaterThan(0);
    expect(r.prompt.length).toBeGreaterThan(0);
  });

  it("summary / strengths / values / wants が prompt に含まれる", () => {
    const r = buildResumeDraftPrompt({ field: "motivation", profile: baseProfile });
    expect(r.prompt).toContain("Web 開発 5 年"); // summary
    expect(r.prompt).toContain("TypeScript"); // strengths
    expect(r.prompt).toContain("挑戦"); // values
    expect(r.prompt).toContain("バックエンド"); // wants
  });

  it("user_facts と concerns は渡さない(脱線・ネガティブ流入防止)", () => {
    const r = buildResumeDraftPrompt({ field: "motivation", profile: baseProfile });
    expect(r.prompt).not.toContain("100-500名"); // user_facts.company_size
    expect(r.prompt).not.toContain("将来の不安"); // concerns
  });

  it("system に捏造防止ルール(虚偽記載防止)が含まれる", () => {
    const r = buildResumeDraftPrompt({ field: "motivation", profile: baseProfile });
    expect(r.system).toContain("虚偽記載防止");
  });

  it("system に「マークダウン記法は使わない」(履歴書欄にそのまま貼る前提)", () => {
    const r = buildResumeDraftPrompt({ field: "motivation", profile: baseProfile });
    expect(r.system).toContain("マークダウン");
  });
});

describe("buildResumeDraftPrompt — personal_requests フィールド", () => {
  it("wants のみ渡す(他フィールドは渡さない)", () => {
    const r = buildResumeDraftPrompt({ field: "personal_requests", profile: baseProfile });
    expect(r.prompt).toContain("バックエンド"); // wants.role_types
    // summary や strengths は含まれない(欄に関係ないため脱線防止)
    expect(r.prompt).not.toContain("Web 開発 5 年");
    expect(r.prompt).not.toContain("TypeScript");
    expect(r.prompt).not.toContain("挑戦");
    expect(r.prompt).not.toContain("将来の不安");
  });

  it("personal_requests でも捏造防止ルールが system に含まれる", () => {
    const r = buildResumeDraftPrompt({ field: "personal_requests", profile: baseProfile });
    expect(r.system).toContain("虚偽記載防止");
  });

  it("プロンプトに「本人希望記入欄」「希望のみ」の文言が入る", () => {
    const r = buildResumeDraftPrompt({ field: "personal_requests", profile: baseProfile });
    expect(r.prompt).toContain("本人希望記入欄");
    expect(r.prompt).toContain("希望のみ");
  });
});

describe("buildResumeDraftPrompt — field ごとの system 切替", () => {
  it("motivation と personal_requests で system が異なる", () => {
    const m = buildResumeDraftPrompt({ field: "motivation", profile: baseProfile });
    const p = buildResumeDraftPrompt({ field: "personal_requests", profile: baseProfile });
    expect(m.system).not.toBe(p.system);
  });
});

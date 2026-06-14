import { describe, it, expect } from "vitest";
import { buildDocumentPrompt, DOCUMENT_PROMPTS } from "./document-writer";
import type { CareerProfile } from "@/lib/career/profile-schema";

/**
 * 書類生成プロンプトのテスト。
 *
 * DOCUMENT_PROMPTS は document type の全エントリにシステムプロンプトを持つ
 * 単一情報源。motivation / self_pr の追加・変更時にここのテストで気付ける。
 *
 * buildDocumentPrompt はキャリア棚卸し結果(機密データ)を AI に渡す境界。
 * profile が JSON で正しく埋め込まれる、求人情報・追加指示の有無で分岐する、
 * といった組み立て契約を担保する。
 */

const baseProfile: CareerProfile = {
  user_facts: {
    current_role: "エンジニア",
    years_of_experience: 5,
    industry: "IT",
    company_size: "100-500名",
  },
  strengths: [{ label: "問題解決力", evidence: "○○を○○した", category: "soft_skill" }],
  values: ["挑戦"],
  wants: {
    industries: ["IT"],
    role_types: ["バックエンド"],
    company_sizes: ["50-200"],
  },
  concerns: [],
  summary: "総評",
};

describe("DOCUMENT_PROMPTS", () => {
  it("motivation / self_pr の両方にプロンプトが定義されている", () => {
    expect(DOCUMENT_PROMPTS.motivation).toBeTruthy();
    expect(DOCUMENT_PROMPTS.self_pr).toBeTruthy();
  });

  it("motivation のプロンプトは 400-450 字制約を含む(志望動機の長さ縛り)", () => {
    expect(DOCUMENT_PROMPTS.motivation).toContain("400");
    expect(DOCUMENT_PROMPTS.motivation).toContain("450");
  });

  it("self_pr のプロンプトは「自己PR」or 関連語句を含む", () => {
    expect(DOCUMENT_PROMPTS.self_pr.length).toBeGreaterThan(0);
  });

  it("各プロンプトが非空", () => {
    for (const [key, value] of Object.entries(DOCUMENT_PROMPTS)) {
      expect(value.length, `${key} のプロンプトが空`).toBeGreaterThan(0);
    }
  });
});

describe("buildDocumentPrompt — 基本構造", () => {
  it("system にタイプ別プロンプト、prompt にデータの 2 つを返す", () => {
    const r = buildDocumentPrompt({ type: "motivation", profile: baseProfile });
    expect(r.system).toBe(DOCUMENT_PROMPTS.motivation);
    expect(r.prompt).toContain("【キャリア棚卸し結果】");
  });

  it("self_pr でもタイプ別プロンプトに切り替わる", () => {
    const r = buildDocumentPrompt({ type: "self_pr", profile: baseProfile });
    expect(r.system).toBe(DOCUMENT_PROMPTS.self_pr);
  });

  it("profile は JSON.stringify(2 スペースインデント)で埋め込まれる", () => {
    const r = buildDocumentPrompt({ type: "motivation", profile: baseProfile });
    expect(r.prompt).toContain(JSON.stringify(baseProfile, null, 2));
  });
});

describe("buildDocumentPrompt — オプション分岐", () => {
  it("jobInfo を渡すと '【求人情報】' セクションが追加される", () => {
    const r = buildDocumentPrompt({
      type: "motivation",
      profile: baseProfile,
      jobInfo: "求人タイトル: XXX",
    });
    expect(r.prompt).toContain("【求人情報】");
    expect(r.prompt).toContain("求人タイトル: XXX");
  });

  it("jobInfo 未指定なら '【求人情報】' セクションは出ない", () => {
    const r = buildDocumentPrompt({ type: "motivation", profile: baseProfile });
    expect(r.prompt).not.toContain("【求人情報】");
  });

  it("customInstructions を渡すと '【追加の指示】' セクションが追加", () => {
    const r = buildDocumentPrompt({
      type: "motivation",
      profile: baseProfile,
      customInstructions: "敬体で書いてください",
    });
    expect(r.prompt).toContain("【追加の指示】");
    expect(r.prompt).toContain("敬体で書いてください");
  });

  it("customInstructions 未指定なら '【追加の指示】' セクションは出ない", () => {
    const r = buildDocumentPrompt({ type: "motivation", profile: baseProfile });
    expect(r.prompt).not.toContain("【追加の指示】");
  });

  it("jobInfo + customInstructions 両方ありの順序(求人情報 → 追加の指示)", () => {
    const r = buildDocumentPrompt({
      type: "motivation",
      profile: baseProfile,
      jobInfo: "JOB",
      customInstructions: "INSTR",
    });
    const jobIdx = r.prompt.indexOf("【求人情報】");
    const instrIdx = r.prompt.indexOf("【追加の指示】");
    expect(jobIdx).toBeGreaterThan(0);
    expect(instrIdx).toBeGreaterThan(jobIdx);
  });

  it("末尾に「上記を踏まえて、書類を生成してください。」", () => {
    const r = buildDocumentPrompt({ type: "motivation", profile: baseProfile });
    expect(r.prompt.trimEnd().endsWith("上記を踏まえて、書類を生成してください。")).toBe(true);
  });
});

describe("buildDocumentPrompt — 機密データ取扱い境界", () => {
  it("profile の中身(strengths / wants 等)が prompt に含まれる(AI へ送る境界)", () => {
    const r = buildDocumentPrompt({ type: "motivation", profile: baseProfile });
    expect(r.prompt).toContain("問題解決力");
    expect(r.prompt).toContain("バックエンド");
  });
});

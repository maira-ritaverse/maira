import { describe, it, expect } from "vitest";
import {
  buildDiagnosisExplainUserPrompt,
  DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT,
  type DiagnosisExplainInput,
} from "./diagnosis-explain";

/**
 * 診断説明文プロンプトのテスト。
 *
 * 「職種を捏造させない」が最重要原則。プロンプトに渡した固定リストの
 * 表記がそのまま出力されているか、リスト無し・拮抗・secondary なしなど
 * 端境のケースで文章構造が崩れないかを境界テスト。
 *
 * SYSTEM プロンプトは「絶対に守ること」セクションを担保(リスト変更時に
 * テストでも気付くようにすると、AI 挙動の事故を未然に防げる)。
 */

const baseInput: DiagnosisExplainInput = {
  primaryAxis: "specialist",
  secondaryAxis: null,
  topStrengths: [],
  jobs: [],
  aptitudeHint: "",
};

describe("DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT", () => {
  it("「職種を捏造しない」原則が含まれる(最重要)", () => {
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("職種を捏造しない");
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("リストにない職種名");
  });

  it("「断定しない」原則が含まれる", () => {
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("断定しない");
  });

  it("「弱みを指摘しない」原則が含まれる", () => {
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("弱みを指摘しない");
  });

  it("形式指定(プレーンテキスト・200〜400字)が含まれる", () => {
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("プレーンテキスト");
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("200");
    expect(DIAGNOSIS_EXPLAIN_SYSTEM_PROMPT).toContain("400");
  });
});

describe("buildDiagnosisExplainUserPrompt — 軸ラベルの埋め込み", () => {
  it("primary 軸のラベルが日本語で埋め込まれる", () => {
    const prompt = buildDiagnosisExplainUserPrompt(baseInput);
    expect(prompt).toContain("主軸: 専門性を極める");
  });

  it("secondary 軸ありなら「次点」として並ぶ", () => {
    const prompt = buildDiagnosisExplainUserPrompt({
      ...baseInput,
      secondaryAxis: "management",
    });
    expect(prompt).toContain("次点: 組織を動かす");
  });

  it("secondary 軸なしなら「主軸が明確」と表記される", () => {
    const prompt = buildDiagnosisExplainUserPrompt({ ...baseInput, secondaryAxis: null });
    expect(prompt).toContain("主軸が明確");
  });
});

describe("buildDiagnosisExplainUserPrompt — 強みの埋め込み", () => {
  it("topStrengths が aptitudeStrengthLabels に変換されて並ぶ", () => {
    const prompt = buildDiagnosisExplainUserPrompt({
      ...baseInput,
      topStrengths: ["openness", "conscientiousness"],
    });
    expect(prompt).toContain("発想力・変化対応");
    expect(prompt).toContain("責任感・継続力");
  });

  it("空配列なら「強みが拮抗、特定の上位なし」", () => {
    const prompt = buildDiagnosisExplainUserPrompt({ ...baseInput, topStrengths: [] });
    expect(prompt).toContain("強みが拮抗");
  });

  it("aptitudeHint が空なら「(なし)」表記", () => {
    const prompt = buildDiagnosisExplainUserPrompt({ ...baseInput, aptitudeHint: "" });
    expect(prompt).toContain("(なし)");
  });
});

describe("buildDiagnosisExplainUserPrompt — 職種候補の埋め込み", () => {
  it("jobs 配列が '- name(description)' 形式で並ぶ", () => {
    const prompt = buildDiagnosisExplainUserPrompt({
      ...baseInput,
      jobs: [
        { name: "研究・技術職", description: "専門分野を深く追求する" },
        { name: "エンジニア", description: "技術を極める" },
      ],
    });
    expect(prompt).toContain("- 研究・技術職(専門分野を深く追求する)");
    expect(prompt).toContain("- エンジニア(技術を極める)");
  });

  it("jobs 空なら「候補なし」表記", () => {
    const prompt = buildDiagnosisExplainUserPrompt({ ...baseInput, jobs: [] });
    expect(prompt).toContain("候補なし");
  });

  it("捏造防止の指示が user prompt にも含まれる(system のみだと長文で効きが弱まる)", () => {
    const prompt = buildDiagnosisExplainUserPrompt({
      ...baseInput,
      jobs: [{ name: "X", description: "Y" }],
    });
    expect(prompt).toContain("リストにない職種を出さない");
  });
});

describe("buildDiagnosisExplainUserPrompt — 文字数・字数指示", () => {
  it("200〜400字 / プレーンテキストの指示が含まれる", () => {
    const prompt = buildDiagnosisExplainUserPrompt(baseInput);
    expect(prompt).toContain("200");
    expect(prompt).toContain("400");
    expect(prompt).toContain("プレーンテキスト");
  });
});

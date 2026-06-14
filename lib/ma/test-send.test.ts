import { describe, it, expect } from "vitest";
import { expandTemplate, type TemplateVariableValues } from "./test-send";

/**
 * テンプレート変数展開の純粋関数テスト。
 *
 * Edge Function 側 template-expander.ts と Web 側 test-send.ts は
 * 同じセマンティクス(既知キーのみ置換、未知キーは残す)を実装している。
 * ここでは Web 側を網羅的にテストし、両者の挙動を「期待値で言語化」する役割。
 */

const FULL: TemplateVariableValues = {
  candidate_name: "山田 太郎",
  candidate_last_name: "山田",
  candidate_first_name: "太郎",
  candidate_email: "taro@example.com",
  agent_name: "大川 亮介",
  agent_last_name: "大川",
  agent_first_name: "亮介",
  organization_name: "株式会社YOROZUYA",
  company_name: "テスト会社",
  job_title: "バックエンドエンジニア",
  interview_date: "2026/06/20",
};

describe("expandTemplate", () => {
  it("既知キーは ctx の値で置換される", () => {
    expect(expandTemplate("{{candidate_name}} 様", FULL)).toBe("山田 太郎 様");
  });

  it("同じキーが複数回出てきても全部置換される", () => {
    expect(expandTemplate("{{candidate_name}} / {{candidate_name}}", FULL)).toBe(
      "山田 太郎 / 山田 太郎",
    );
  });

  it("複数の異なるキーを 1 つの文中で展開する", () => {
    expect(
      expandTemplate("{{candidate_name}} 様、{{organization_name}} の {{agent_name}} です。", FULL),
    ).toBe("山田 太郎 様、株式会社YOROZUYA の 大川 亮介 です。");
  });

  it("11 個全ての変数を一度に展開できる", () => {
    const template = Object.keys(FULL)
      .map((k) => `${k}=<{{${k}}}>`)
      .join(", ");
    const expected = Object.entries(FULL)
      .map(([k, v]) => `${k}=<${v}>`)
      .join(", ");
    expect(expandTemplate(template, FULL)).toBe(expected);
  });

  it("未知キーは {{xxx}} のまま残る(運用ミス検知)", () => {
    expect(expandTemplate("Hello {{unknown_key}}!", FULL)).toBe("Hello {{unknown_key}}!");
  });

  it("値が空文字なら空文字に置換(プレースホルダ文字列は出さない)", () => {
    const emptyAgent: TemplateVariableValues = { ...FULL, agent_name: "" };
    expect(expandTemplate("担当: {{agent_name}} です", emptyAgent)).toBe("担当:  です");
  });

  it("変数が含まれない素のテキストは変化しない", () => {
    expect(expandTemplate("普通のメール本文", FULL)).toBe("普通のメール本文");
    expect(expandTemplate("", FULL)).toBe("");
  });

  it("HTML / 改行 / 特殊文字を壊さない(エスケープしない)", () => {
    const html = "<p>{{candidate_name}}\n様</p>";
    expect(expandTemplate(html, FULL)).toBe("<p>山田 太郎\n様</p>");
  });

  it("既知キーと未知キーが混在しても、既知だけ展開される", () => {
    expect(expandTemplate("{{candidate_name}} と {{nope}} と {{agent_name}}", FULL)).toBe(
      "山田 太郎 と {{nope}} と 大川 亮介",
    );
  });

  it("値に {{...}} が含まれていても再展開しない(無限ループ回避)", () => {
    const ctxWithToken: TemplateVariableValues = {
      ...FULL,
      candidate_name: "{{agent_name}}",
    };
    // 1 パスのみの置換なので、値内の {{agent_name}} は残る
    expect(expandTemplate("Hello {{candidate_name}}", ctxWithToken)).toBe("Hello {{agent_name}}");
  });
});

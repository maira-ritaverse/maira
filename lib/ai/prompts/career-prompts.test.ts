import { describe, it, expect } from "vitest";
import { CAREER_INVENTORY_SYSTEM_PROMPT } from "./career-inventory";
import { CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT } from "./career-profile-generator";

/**
 * キャリア棚卸し関連のシステムプロンプトテスト。
 *
 * 棚卸し対話プロンプトと、その後の構造化プロンプトはペアで動く。
 * 構造化側の「会話に出てこない情報は絶対に書かない」原則が壊れると、
 * AI が推測でユーザーの強みを捏造して career_profile に保存される事故になる。
 * 主要な原則文言を assert で固定し、不用意な文言削除を検知する。
 */

describe("CAREER_INVENTORY_SYSTEM_PROMPT(対話プロンプト)", () => {
  it("非空", () => {
    expect(CAREER_INVENTORY_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("「Myaira」または「マイラ」を名乗る指示が含まれる", () => {
    expect(
      CAREER_INVENTORY_SYSTEM_PROMPT.includes("Myaira") ||
        CAREER_INVENTORY_SYSTEM_PROMPT.includes("マイラ"),
    ).toBe(true);
  });

  it("対象ターゲット(20-30代の転職者)が明示されている", () => {
    expect(CAREER_INVENTORY_SYSTEM_PROMPT).toContain("20-30代");
  });
});

describe("CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT(構造化プロンプト)", () => {
  it("「会話に出てこない情報は絶対に書かない」原則が含まれる(最重要)", () => {
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("絶対に書かない");
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("推測");
  });

  it("strengths は「最大5個まで」「エビデンスが薄ければ少なくする」", () => {
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("最大5個");
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("エビデンス");
  });

  it("strengths の category(hard_skill / soft_skill / experience)が明示されている", () => {
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("hard_skill");
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("soft_skill");
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("experience");
  });

  it("summary は 150-250字で記述する指示が含まれる", () => {
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("150");
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("250");
  });

  it("評価語(「すごい」「素晴らしい」)を入れない指示", () => {
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("評価語");
  });

  it("「データが不足する場合」のフォールバック方針が含まれる", () => {
    expect(CAREER_PROFILE_GENERATOR_SYSTEM_PROMPT).toContain("データが不足");
  });
});

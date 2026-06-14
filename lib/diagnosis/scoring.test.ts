import { describe, it, expect } from "vitest";
import { axisQuestions } from "./axis-questions";
import { aptitudeQuestions } from "./aptitude-questions";
import { scoreAptitude, scoreAxis, suggestJobs } from "./scoring";

/**
 * キャリア診断スコアリングの境界テスト。
 *
 * 「不正値の混入」「全 0 点」「同点僅差」が頻発する診断ロジックで、
 * フォールバックの分岐(secondary=null / topStrengths=[])が正しく
 * 機能していないとユーザに「主軸: undefined」が表示される事故になる。
 *
 * threshold(80%)は実務的に決めた値で、この閾値が崩れると「無関係な軸が
 * secondary に並ぶ」or「上位が 1 個だけになる」など UX が荒れる。境界値で
 * 固定する。
 */

// 全質問に同じ点数を入れるヘルパー(回答完了の最小ケース)
function allAnswers(score: number, questions: ReadonlyArray<{ id: string }>) {
  const result: Record<string, number> = {};
  for (const q of questions) result[q.id] = score;
  return result;
}

describe("scoreAxis — 基本", () => {
  it("空回答なら全 0 点、primary=specialist(emptyAxisScores の先頭、安定ソート)", () => {
    const r = scoreAxis({});
    expect(Object.values(r.scores).every((v) => v === 0)).toBe(true);
    expect(r.primary).toBe("specialist"); // 同点なら定義順の先頭
    expect(r.secondary).toBeNull(); // 全 0 点なら secondary は出さない
  });

  it("全質問に 4 点で全タイプ最高得点、同点なので secondary は出る", () => {
    const r = scoreAxis(allAnswers(4, axisQuestions));
    // 全タイプ 2 問 × 4 点 = 8 点
    expect(Object.values(r.scores).every((v) => v === 8)).toBe(true);
    // 同点なので primary=先頭(specialist)、secondary=2 番目(management)
    expect(r.primary).toBe("specialist");
    expect(r.secondary).toBe("management");
  });

  it("不正値(0 / 5 / 文字列 / NaN)は無視される(防御的)", () => {
    const r = scoreAxis({
      ax01: 0, // 範囲外
      ax02: 5, // 範囲外
      ax03: "x" as unknown as number,
      ax04: NaN,
    });
    // どれもスコアに加算されないので全タイプ 0 点
    expect(Object.values(r.scores).every((v) => v === 0)).toBe(true);
  });

  it("未知の id は無視される(意図しないキーで分母が動かない)", () => {
    expect(scoreAxis({ unknown_id: 4 }).scores.specialist).toBe(0);
  });
});

describe("scoreAxis — secondary 閾値(80%)", () => {
  it("主軸 8 / 次点 7 = 87.5% は secondary が出る", () => {
    const r = scoreAxis({
      // specialist: 4+4 = 8
      ax01: 4,
      ax02: 4,
      // management: 4+3 = 7 (87.5%)
      ax03: 4,
      ax04: 3,
    });
    expect(r.primary).toBe("specialist");
    expect(r.secondary).toBe("management");
  });

  it("主軸 8 / 次点 6 = 75% は secondary が null(80% 未満)", () => {
    const r = scoreAxis({
      // specialist: 4+4 = 8
      ax01: 4,
      ax02: 4,
      // management: 3+3 = 6 (75%)
      ax03: 3,
      ax04: 3,
    });
    expect(r.primary).toBe("specialist");
    expect(r.secondary).toBeNull();
  });

  it("ちょうど 80%(8 / 6.4)は…6.4 が無いので 7 で OK / 6 で NG", () => {
    // floor 値の確認:6 < 8 * 0.8 = 6.4 → false(NG)
    const a = scoreAxis({ ax01: 4, ax02: 4, ax03: 3, ax04: 3 });
    expect(a.secondary).toBeNull();
  });
});

describe("scoreAptitude — 基本", () => {
  it("空回答なら全 0 点、topStrengths は空", () => {
    const r = scoreAptitude({});
    expect(Object.values(r.scores).every((v) => v === 0)).toBe(true);
    expect(r.topStrengths).toEqual([]);
  });

  it("全問 4 点なら全因子最高得点、topStrengths は最大 3 個", () => {
    const r = scoreAptitude(allAnswers(4, aptitudeQuestions));
    // 同点なので上位 3 個まで採用(slice(0, 3))
    expect(r.topStrengths).toHaveLength(3);
    // 5 因子なので、4 番目以降は出ない
    expect(r.topStrengths.length).toBeLessThanOrEqual(3);
  });

  it("topStrengths は 1 位の 80% 未満を除外", () => {
    // openness: 8 / 他: 6(75%、外れる)
    const answers: Record<string, number> = {
      ap01: 4,
      ap02: 4, // openness 8
      ap03: 3,
      ap04: 3, // conscientiousness 6
      ap05: 3,
      ap06: 3, // extraversion 6
      ap07: 3,
      ap08: 3, // agreeableness 6
      ap09: 3,
      ap10: 3, // stability 6
    };
    const r = scoreAptitude(answers);
    expect(r.topStrengths).toEqual(["openness"]);
  });

  it("不正値は無視される(範囲外 / NaN)", () => {
    expect(scoreAptitude({ ap01: 0, ap02: 5, ap03: NaN }).scores.openness).toBe(0);
  });
});

describe("suggestJobs — primary のみ", () => {
  it("primary 軸の職種が全部入る", () => {
    const r = suggestJobs(
      { primary: "specialist", secondary: null, scores: {} as never },
      { scores: {} as never, topStrengths: [] },
    );
    expect(r.categories.length).toBeGreaterThanOrEqual(2);
    expect(r.categories.some((c) => c.name.includes("研究"))).toBe(true);
  });

  it("topStrengths 空なら aptitudeHint は空文字", () => {
    const r = suggestJobs(
      { primary: "specialist", secondary: null, scores: {} as never },
      { scores: {} as never, topStrengths: [] },
    );
    expect(r.aptitudeHint).toBe("");
  });
});

describe("suggestJobs — secondary 込み", () => {
  it("secondary の先頭 1 つだけ混ぜる(全部混ぜると候補がぼやけるため)", () => {
    const r = suggestJobs(
      { primary: "specialist", secondary: "management", scores: {} as never },
      { scores: {} as never, topStrengths: ["openness"] },
    );
    // primary(specialist)3 件 + secondary(management)1 件 = 4 件想定
    // ただし重複排除で減る可能性あり
    expect(r.categories.length).toBeLessThanOrEqual(4);
    expect(r.categories.length).toBeGreaterThanOrEqual(3);
  });

  it("primary と secondary で職種名が被ったら 1 件に dedup", () => {
    // management と challenge は両方 'コンサルタント' を持つ
    const r = suggestJobs(
      { primary: "management", secondary: "challenge", scores: {} as never },
      { scores: {} as never, topStrengths: [] },
    );
    const consultantCount = r.categories.filter((c) => c.name === "コンサルタント").length;
    expect(consultantCount).toBe(1); // 重複排除されている
  });

  it("topStrengths の先頭が aptitudeHint に変換される", () => {
    const r = suggestJobs(
      { primary: "specialist", secondary: null, scores: {} as never },
      { scores: {} as never, topStrengths: ["openness", "conscientiousness"] },
    );
    expect(r.aptitudeHint).toContain("新しい");
  });
});

describe("axis-questions / aptitude-questions の構造", () => {
  it("axisQuestions の id は重複しない", () => {
    const ids = axisQuestions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("aptitudeQuestions の id は重複しない", () => {
    const ids = aptitudeQuestions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

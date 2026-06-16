/**
 * matching/score.ts のテスト
 *
 * 配点 / 各観点の独立動作 / 欠損の扱い / ランキング(top N + 除外)を網羅。
 */
import { describe, expect, it } from "vitest";

import { rankMatches, scoreMatch, type MatchClientInput, type MatchJobInput } from "./score";

function client(overrides: Partial<MatchClientInput> = {}): MatchClientInput {
  return {
    desiredLocations: [],
    desiredOccupations: [],
    desiredAnnualIncome: null,
    currentEmploymentType: null,
    ...overrides,
  };
}

function job(overrides: Partial<MatchJobInput> = {}): MatchJobInput {
  return {
    id: "j-1",
    companyName: "サンプル株式会社",
    position: "Webエンジニア",
    location: "東京",
    salaryMin: 500,
    salaryMax: 800,
    employmentType: "正社員",
    ...overrides,
  };
}

describe("scoreMatch", () => {
  it("欠損だらけ(クライアント情報なし)は 0 点", () => {
    const r = scoreMatch(client(), job());
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it("勤務地一致で +30(部分一致)", () => {
    const r = scoreMatch(client({ desiredLocations: ["東京"] }), job({ location: "東京都港区" }));
    expect(r.score).toBe(30);
    expect(r.reasons).toEqual(["location"]);
  });

  it("年収レンジ内で +30", () => {
    const r = scoreMatch(
      client({ desiredAnnualIncome: 650 }),
      job({ salaryMin: 500, salaryMax: 800 }),
    );
    expect(r.score).toBe(30);
    expect(r.reasons).toEqual(["salary"]);
  });

  it("年収レンジを下回ると 0", () => {
    const r = scoreMatch(
      client({ desiredAnnualIncome: 400 }),
      job({ salaryMin: 500, salaryMax: 800 }),
    );
    expect(r.score).toBe(0);
  });

  it("年収レンジを上回ると 0", () => {
    const r = scoreMatch(
      client({ desiredAnnualIncome: 900 }),
      job({ salaryMin: 500, salaryMax: 800 }),
    );
    expect(r.score).toBe(0);
  });

  it("年収上限 null は無限大として扱う", () => {
    const r = scoreMatch(
      client({ desiredAnnualIncome: 1500 }),
      job({ salaryMin: 500, salaryMax: null }),
    );
    expect(r.score).toBe(30);
  });

  it("職種キーワード一致で +25(複数のうち 1 個でも当たればOK)", () => {
    const r = scoreMatch(
      client({ desiredOccupations: ["デザイナー", "エンジニア"] }),
      job({ position: "フロントエンドエンジニア" }),
    );
    expect(r.score).toBe(25);
    expect(r.reasons).toEqual(["position"]);
  });

  it("雇用形態完全一致で +15(全半角差は吸収)", () => {
    const r = scoreMatch(
      client({ currentEmploymentType: "正社員" }),
      job({ employmentType: "正社員" }),
    );
    expect(r.score).toBe(15);
    expect(r.reasons).toEqual(["employment"]);
  });

  it("全観点満点で 100 点", () => {
    const r = scoreMatch(
      client({
        desiredLocations: ["東京"],
        desiredOccupations: ["エンジニア"],
        desiredAnnualIncome: 600,
        currentEmploymentType: "正社員",
      }),
      job({
        location: "東京都新宿",
        position: "バックエンドエンジニア",
        salaryMin: 500,
        salaryMax: 800,
        employmentType: "正社員",
      }),
    );
    expect(r.score).toBe(100);
    expect(r.reasons.sort()).toEqual(["employment", "location", "position", "salary"]);
  });

  it("空文字 / 空白だけのキーワードは加点しない", () => {
    const r = scoreMatch(client({ desiredLocations: ["", "  "] }), job({ location: "東京" }));
    expect(r.score).toBe(0);
  });
});

describe("rankMatches", () => {
  it("空入力は空配列", () => {
    expect(rankMatches(client(), [])).toEqual([]);
  });

  it("topN を超える数は切り詰め", () => {
    const cli = client({ desiredLocations: ["東京"] });
    const jobs = Array.from({ length: 10 }, (_, i) => job({ id: `j-${i}`, location: "東京" }));
    const r = rankMatches(cli, jobs, { topN: 3 });
    expect(r).toHaveLength(3);
  });

  it("スコア降順でソート", () => {
    const cli = client({
      desiredLocations: ["東京"],
      desiredAnnualIncome: 600,
      desiredOccupations: ["エンジニア"],
    });
    const jobs = [
      job({ id: "j-only-loc", location: "東京", position: "営業", salaryMin: 100, salaryMax: 200 }),
      job({
        id: "j-three",
        location: "東京",
        position: "エンジニア",
        salaryMin: 500,
        salaryMax: 800,
      }),
    ];
    const r = rankMatches(cli, jobs);
    expect(r[0].jobId).toBe("j-three");
    expect(r[1].jobId).toBe("j-only-loc");
  });

  it("excludeJobIds は除外される", () => {
    const cli = client({ desiredLocations: ["東京"] });
    const jobs = [job({ id: "j-1", location: "東京" }), job({ id: "j-2", location: "東京" })];
    const r = rankMatches(cli, jobs, { excludeJobIds: new Set(["j-1"]) });
    expect(r.map((m) => m.jobId)).toEqual(["j-2"]);
  });

  it("minScore 未満は採用しない", () => {
    const cli = client({ desiredLocations: ["大阪"] }); // どの job ともマッチしない
    const jobs = [job({ id: "j-a", location: "東京" }), job({ id: "j-b", location: "京都" })];
    const r = rankMatches(cli, jobs, { minScore: 1 });
    expect(r).toEqual([]);
  });

  it("入力配列を破壊しない", () => {
    const cli = client({ desiredLocations: ["東京"] });
    const jobs = [job({ id: "j-1", location: "東京" }), job({ id: "j-2", location: "東京" })];
    const orig = [...jobs];
    rankMatches(cli, jobs);
    expect(jobs).toEqual(orig);
  });
});

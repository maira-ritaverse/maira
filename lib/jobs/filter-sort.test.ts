import { describe, expect, it } from "vitest";

import {
  applyJobsFilterSort,
  buildJobLocationOptions,
  type JobFilterSortOptions,
  type JobForFilterSort,
} from "./filter-sort";

function job(overrides: Partial<JobForFilterSort> = {}): JobForFilterSort {
  return {
    id: `j-${Math.floor(Math.random() * 1000000)}`,
    companyName: "サンプル株式会社",
    position: "Webエンジニア",
    location: "東京",
    salaryMin: 500,
    salaryMax: 800,
    status: "open",
    employmentType: "正社員",
    createdAt: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

const baseOpts: JobFilterSortOptions = {
  searchQuery: "",
  statusFilter: "all",
  locationKeyword: "",
  sortColumn: "createdAt",
  sortDirection: "desc",
};

describe("applyJobsFilterSort", () => {
  it("空クエリは全件返す", () => {
    expect(applyJobsFilterSort([job(), job(), job()], baseOpts)).toHaveLength(3);
  });

  it("会社名で検索", () => {
    const r = applyJobsFilterSort(
      [job({ id: "a", companyName: "サンプル株式会社" }), job({ id: "b", companyName: "別会社" })],
      { ...baseOpts, searchQuery: "サンプル" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("ポジション・勤務地でも検索ヒット", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "a", position: "Webエンジニア", location: "東京" }),
        job({ id: "b", position: "営業", location: "大阪" }),
      ],
      { ...baseOpts, searchQuery: "エンジニア" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("スコープ拡張: description / スキル欄にもマッチする", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "a", description: "TypeScript の SPA 開発", requiredSkills: null }),
        job({ id: "b", requiredSkills: "TypeScript 3 年以上", description: null }),
        job({ id: "c", preferredSkills: "TypeScript 経験優遇" }),
        job({ id: "d", position: "営業" }),
      ],
      { ...baseOpts, searchQuery: "TypeScript" },
    );
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("スペース区切りは AND (「Web エンジニア」で 2 語両方含む必要)", () => {
    const r = applyJobsFilterSort(
      [
        // "Webエンジニア" は NFKC 後 "webエンジニア" となり "web" と "エンジニア" の
        // 両トークンが 1 つの文字列内で連続して存在する → AND ヒット
        job({ id: "a", position: "Webエンジニア", location: "東京" }),
        // "Web デザイナー" は "web" は当たるが "エンジニア" が無いので不一致
        job({ id: "b", position: "Web デザイナー", location: "東京" }),
      ],
      { ...baseOpts, searchQuery: "Web エンジニア" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("ステータスフィルタ", () => {
    const r = applyJobsFilterSort(
      [job({ id: "a", status: "open" }), job({ id: "b", status: "paused" })],
      { ...baseOpts, statusFilter: "open" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("勤務地キーワード", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "a", location: "東京都港区" }),
        job({ id: "b", location: "大阪市" }),
        job({ id: "c", location: null }),
      ],
      { ...baseOpts, locationKeyword: "東京" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("年収レンジ(下限のみ):求人上限が下限を上回るものだけ残す", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "a", salaryMin: 300, salaryMax: 400 }),
        job({ id: "b", salaryMin: 500, salaryMax: 800 }),
        job({ id: "c", salaryMin: 800, salaryMax: 1200 }),
      ],
      { ...baseOpts, minSalary: 500 },
    );
    expect(r.map((x) => x.id).sort()).toEqual(["b", "c"]);
  });

  it("年収レンジ(上限のみ):求人下限が上限を超えるものは除外", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "a", salaryMin: 300, salaryMax: 400 }),
        job({ id: "b", salaryMin: 500, salaryMax: 800 }),
        job({ id: "c", salaryMin: 800, salaryMax: 1200 }),
      ],
      { ...baseOpts, maxSalary: 700 },
    );
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("年収レンジ(範囲):両条件を AND で適用", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "a", salaryMin: 300, salaryMax: 400 }),
        job({ id: "b", salaryMin: 500, salaryMax: 800 }),
        job({ id: "c", salaryMin: 800, salaryMax: 1200 }),
      ],
      { ...baseOpts, minSalary: 600, maxSalary: 900 },
    );
    expect(r.map((x) => x.id).sort()).toEqual(["b", "c"]);
  });

  it("salary 列でのソート", () => {
    const r = applyJobsFilterSort(
      [
        job({ id: "low", salaryMax: 400 }),
        job({ id: "high", salaryMax: 1000 }),
        job({ id: "mid", salaryMax: 600 }),
      ],
      { ...baseOpts, sortColumn: "salary", sortDirection: "asc" },
    );
    expect(r.map((x) => x.id)).toEqual(["low", "mid", "high"]);
  });

  it("入力配列を破壊しない", () => {
    const arr = [job({ id: "a" }), job({ id: "b" })];
    const orig = [...arr];
    applyJobsFilterSort(arr, baseOpts);
    expect(arr).toEqual(orig);
  });
});

describe("buildJobLocationOptions", () => {
  it("空入力は空配列", () => {
    expect(buildJobLocationOptions([])).toEqual([]);
  });

  it("件数降順", () => {
    const r = buildJobLocationOptions([
      job({ location: "東京" }),
      job({ location: "東京" }),
      job({ location: "大阪" }),
      job({ location: null }),
    ]);
    expect(r[0]).toEqual(["東京", 2]);
    expect(r[1]).toEqual(["大阪", 1]);
  });
});

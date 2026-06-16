import { describe, expect, it } from "vitest";

import {
  applyApplicationsFilterSort,
  summarizeByStatus,
  summarizeDue,
  type AppFilterSortOptions,
  type ApplicationForFilterSort,
} from "./filter-sort";

function app(overrides: Partial<ApplicationForFilterSort> = {}): ApplicationForFilterSort {
  return {
    id: `a-${Math.floor(Math.random() * 1000000)}`,
    details: { company: "サンプル株式会社", position: "Webエンジニア" },
    status: "considering",
    applied_at: null,
    next_action_at: null,
    created_at: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

const baseOpts: AppFilterSortOptions = {
  searchQuery: "",
  statusFilter: "all",
  dueFilter: "any",
  sortColumn: "createdAt",
  sortDirection: "desc",
};

describe("applyApplicationsFilterSort", () => {
  it("空クエリは全件返す", () => {
    expect(applyApplicationsFilterSort([app(), app(), app()], baseOpts)).toHaveLength(3);
  });

  it("会社名で検索", () => {
    const r = applyApplicationsFilterSort(
      [
        app({ id: "a", details: { company: "サンプル株式会社", position: "営業" } }),
        app({ id: "b", details: { company: "別会社", position: "エンジニア" } }),
      ],
      { ...baseOpts, searchQuery: "サンプル" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("職種でも検索ヒット", () => {
    const r = applyApplicationsFilterSort(
      [
        app({ id: "a", details: { company: "A", position: "エンジニア" } }),
        app({ id: "b", details: { company: "B", position: "営業" } }),
      ],
      { ...baseOpts, searchQuery: "エンジニア" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("ステータスフィルタ", () => {
    const r = applyApplicationsFilterSort(
      [app({ id: "a", status: "applied" }), app({ id: "b", status: "considering" })],
      { ...baseOpts, statusFilter: "applied" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("dueFilter=overdue は now より前のもの", () => {
    const now = Date.parse("2026-06-15T00:00:00Z");
    const r = applyApplicationsFilterSort(
      [
        app({ id: "past", next_action_at: "2026-06-14T00:00:00Z" }),
        app({ id: "future", next_action_at: "2026-06-20T00:00:00Z" }),
        app({ id: "none", next_action_at: null }),
      ],
      { ...baseOpts, dueFilter: "overdue", now },
    );
    expect(r.map((x) => x.id)).toEqual(["past"]);
  });

  it("dueFilter=soon は 7 日以内", () => {
    const now = Date.parse("2026-06-15T00:00:00Z");
    const r = applyApplicationsFilterSort(
      [
        app({ id: "tomorrow", next_action_at: "2026-06-16T00:00:00Z" }),
        app({ id: "far", next_action_at: "2026-06-30T00:00:00Z" }),
        app({ id: "past", next_action_at: "2026-06-14T00:00:00Z" }),
      ],
      { ...baseOpts, dueFilter: "soon", now },
    );
    expect(r.map((x) => x.id)).toEqual(["tomorrow"]);
  });

  it("dueFilter=none は next_action_at が null のもの", () => {
    const r = applyApplicationsFilterSort(
      [
        app({ id: "a", next_action_at: null }),
        app({ id: "b", next_action_at: "2026-06-20T00:00:00Z" }),
      ],
      { ...baseOpts, dueFilter: "none" },
    );
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("nextActionAt 昇順:null は末尾", () => {
    const r = applyApplicationsFilterSort(
      [
        app({ id: "no_due", next_action_at: null }),
        app({ id: "late", next_action_at: "2026-07-01T00:00:00Z" }),
        app({ id: "soon", next_action_at: "2026-06-16T00:00:00Z" }),
      ],
      { ...baseOpts, sortColumn: "nextActionAt", sortDirection: "asc" },
    );
    expect(r.map((x) => x.id)).toEqual(["soon", "late", "no_due"]);
  });
});

describe("summarizeByStatus", () => {
  it("全ステータスのキーが存在", () => {
    const r = summarizeByStatus([
      app({ status: "applied" }),
      app({ status: "applied" }),
      app({ status: "considering" }),
    ]);
    expect(r.applied).toBe(2);
    expect(r.considering).toBe(1);
  });
});

describe("summarizeDue", () => {
  it("overdue / soon / none を分けて集計", () => {
    const now = Date.parse("2026-06-15T00:00:00Z");
    const r = summarizeDue(
      [
        app({ next_action_at: "2026-06-14T00:00:00Z" }),
        app({ next_action_at: "2026-06-16T00:00:00Z" }),
        app({ next_action_at: "2026-07-30T00:00:00Z" }),
        app({ next_action_at: null }),
      ],
      now,
    );
    expect(r.overdue).toBe(1);
    expect(r.soon).toBe(1);
    expect(r.none).toBe(1);
    expect(r.total).toBe(4);
  });
});

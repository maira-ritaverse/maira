/**
 * data-quality.ts のテスト
 */
import { describe, expect, it } from "vitest";

import { evaluateDataQuality, type DataQualityCheckable } from "./data-quality";

function client(overrides: Partial<DataQualityCheckable> = {}): DataQualityCheckable {
  return {
    id: `id-${Math.floor(Math.random() * 1000000)}`,
    name: "田中太郎",
    status: "job_matching",
    phone: "090-0000-0000",
    nameKana: "タナカタロウ",
    prefecture: "東京都",
    intakeDate: "2026-06-01",
    currentEmploymentType: "full_time",
    desiredLocations: ["東京"],
    desiredAnnualIncome: 600,
    assignedMemberId: "mem-1",
    ...overrides,
  };
}

describe("evaluateDataQuality", () => {
  it("空入力は 0 件で全て 0 未入力", () => {
    const r = evaluateDataQuality([]);
    expect(r.evaluatedCount).toBe(0);
    expect(r.completeCount).toBe(0);
    expect(r.missingByField.phone).toBe(0);
  });

  it("完了 / 見送り は評価対象外", () => {
    const r = evaluateDataQuality([
      client({ id: "a", status: "completed", phone: null }),
      client({ id: "b", status: "declined", phone: null }),
      client({ id: "c", phone: "090-1111-1111" }),
    ]);
    expect(r.evaluatedCount).toBe(1);
    expect(r.completeCount).toBe(1);
    expect(r.missingByField.phone).toBe(0);
  });

  it("phone が空文字 / null は未入力扱い", () => {
    const r = evaluateDataQuality([
      client({ id: "a", phone: "" }),
      client({ id: "b", phone: null }),
      client({ id: "c", phone: "  " }),
    ]);
    expect(r.missingByField.phone).toBe(3);
  });

  it("desired_locations が空配列は未入力扱い", () => {
    const r = evaluateDataQuality([client({ desiredLocations: [] })]);
    expect(r.missingByField.desired_locations).toBe(1);
  });

  it("topMissingByField は最大 5 件まで", () => {
    const xs = Array.from({ length: 7 }, (_, i) =>
      client({ id: `id-${i}`, phone: null, name: `T-${i}` }),
    );
    const r = evaluateDataQuality(xs);
    expect(r.missingByField.phone).toBe(7);
    expect(r.topMissingByField.phone).toHaveLength(5);
  });

  it("全部埋まっていれば completeCount に加算", () => {
    const r = evaluateDataQuality([client(), client(), client()]);
    expect(r.completeCount).toBe(3);
  });

  it("一部未入力なら completeCount に加算されない", () => {
    const r = evaluateDataQuality([client({ phone: null })]);
    expect(r.completeCount).toBe(0);
    expect(r.missingByField.phone).toBe(1);
  });
});

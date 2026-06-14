import { describe, it, expect } from "vitest";
import { LABOUR_FIELD_NAMES } from "./labour-progress-badge";
import { LABOUR_FIELDS_TOTAL } from "@/lib/jobs/types";

/**
 * 法定明示事項 8 列のフィールド名リスト構造テスト。
 *
 * LABOUR_FIELD_NAMES は React フォームの useWatch に渡され、同じ 8 列は
 * lib/jobs/types.ts の countLabourFieldsFilled でも数える。両者がズレると
 * 「フォームでは 8/8 緑だが一覧では赤」という UI 矛盾が起きる。
 *
 * 名前は createJobRequestSchema / updateJobRequestSchema の zod キーと一致する
 * 必要があるため、現行値そのものを assert で固定する(意図しない rename を検知)。
 */

const EXPECTED_NAMES = [
  "work_change_scope",
  "location_change_scope",
  "smoking_prevention_measure",
  "probation_period",
  "work_hours",
  "break_time",
  "holidays",
  "application_qualifications",
] as const;

describe("LABOUR_FIELD_NAMES", () => {
  it("LABOUR_FIELDS_TOTAL(=8)と要素数が一致", () => {
    expect(LABOUR_FIELD_NAMES).toHaveLength(LABOUR_FIELDS_TOTAL);
  });

  it("現行 8 つのキーが正確に並ぶ(zod キーとマイグレ列名の単一情報源)", () => {
    expect(LABOUR_FIELD_NAMES).toEqual(EXPECTED_NAMES);
  });

  it("重複した名前は無い(同じキーを 2 回監視すると分母が壊れる)", () => {
    expect(new Set(LABOUR_FIELD_NAMES).size).toBe(LABOUR_FIELD_NAMES.length);
  });

  it("全て snake_case(API 受け口 / DB 列名と一致)", () => {
    for (const name of LABOUR_FIELD_NAMES) {
      // 英小文字とアンダースコアのみ。CamelCase で書き直す変更を検知。
      expect(name).toMatch(/^[a-z][a-z_]*[a-z]$/);
    }
  });
});

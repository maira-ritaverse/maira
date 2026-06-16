import { describe, expect, it } from "vitest";

import { DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, parseExportColumnsParam } from "./export-columns";

describe("parseExportColumnsParam", () => {
  it("null / 空文字 はデフォルトを返す", () => {
    expect(parseExportColumnsParam(null)).toEqual(DEFAULT_EXPORT_COLUMNS);
    expect(parseExportColumnsParam("")).toEqual(DEFAULT_EXPORT_COLUMNS);
  });

  it("既知のキーだけ採用、未知は無視", () => {
    const r = parseExportColumnsParam("name,unknown_field,email");
    expect(r).toEqual(["name", "email"]);
  });

  it("未知キーだけならデフォルトにフォールバック", () => {
    expect(parseExportColumnsParam("foo,bar")).toEqual(DEFAULT_EXPORT_COLUMNS);
  });

  it("前後空白はトリム", () => {
    const r = parseExportColumnsParam(" name , email ");
    expect(r).toEqual(["name", "email"]);
  });

  it("出力順は入力順を維持", () => {
    const r = parseExportColumnsParam("email,name");
    expect(r).toEqual(["email", "name"]);
  });
});

describe("EXPORT_COLUMNS / DEFAULT_EXPORT_COLUMNS", () => {
  it("DEFAULT_EXPORT_COLUMNS は EXPORT_COLUMNS に含まれるキーだけ", () => {
    const allKeys = new Set(EXPORT_COLUMNS.map((c) => c.key));
    for (const k of DEFAULT_EXPORT_COLUMNS) {
      expect(allKeys.has(k)).toBe(true);
    }
  });

  it("EXPORT_COLUMNS は key 重複なし", () => {
    const keys = EXPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

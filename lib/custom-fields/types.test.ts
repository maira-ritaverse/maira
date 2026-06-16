import { describe, expect, it } from "vitest";

import { validateValue, type CustomFieldDefinition } from "./types";

function def(
  overrides: Partial<Pick<CustomFieldDefinition, "fieldType" | "options" | "isRequired">> = {},
): Pick<CustomFieldDefinition, "fieldType" | "options" | "isRequired"> {
  return {
    fieldType: "text",
    options: [],
    isRequired: false,
    ...overrides,
  };
}

describe("validateValue", () => {
  describe("空値", () => {
    it("null / undefined / 空文字 はそのまま null として OK(非必須)", () => {
      const d = def();
      expect(validateValue(d, null)).toEqual({ ok: true, value: null });
      expect(validateValue(d, undefined)).toEqual({ ok: true, value: null });
      expect(validateValue(d, "")).toEqual({ ok: true, value: null });
    });

    it("isRequired=true で空はエラー", () => {
      const d = def({ isRequired: true });
      expect(validateValue(d, "")).toEqual({ ok: false, error: "必須項目です" });
      expect(validateValue(d, null)).toEqual({ ok: false, error: "必須項目です" });
    });
  });

  describe("text", () => {
    it("文字列は通る", () => {
      expect(validateValue(def({ fieldType: "text" }), "hi")).toEqual({ ok: true, value: "hi" });
    });

    it("非文字列はエラー", () => {
      expect(validateValue(def({ fieldType: "text" }), 1)).toEqual({
        ok: false,
        error: "文字列を入力してください",
      });
    });

    it("1000 文字超はエラー", () => {
      const s = "a".repeat(1001);
      expect(validateValue(def({ fieldType: "text" }), s)).toEqual({
        ok: false,
        error: "1000 文字以内で入力してください",
      });
    });
  });

  describe("number", () => {
    it("数値はそのまま", () => {
      expect(validateValue(def({ fieldType: "number" }), 42)).toEqual({ ok: true, value: 42 });
    });

    it("数値化できる文字列は数値に変換", () => {
      expect(validateValue(def({ fieldType: "number" }), "3.14")).toEqual({
        ok: true,
        value: 3.14,
      });
    });

    it("数値化できないとエラー", () => {
      expect(validateValue(def({ fieldType: "number" }), "abc")).toEqual({
        ok: false,
        error: "数値を入力してください",
      });
    });
  });

  describe("date", () => {
    it("YYYY-MM-DD はそのまま", () => {
      expect(validateValue(def({ fieldType: "date" }), "2026-06-15")).toEqual({
        ok: true,
        value: "2026-06-15",
      });
    });

    it("フォーマット違反はエラー", () => {
      expect(validateValue(def({ fieldType: "date" }), "2026/06/15")).toEqual({
        ok: false,
        error: "YYYY-MM-DD 形式で入力してください",
      });
    });
  });

  describe("select", () => {
    it("選択肢内の値は OK", () => {
      const d = def({ fieldType: "select", options: ["A", "B"] });
      expect(validateValue(d, "A")).toEqual({ ok: true, value: "A" });
    });

    it("選択肢外の値はエラー", () => {
      const d = def({ fieldType: "select", options: ["A", "B"] });
      expect(validateValue(d, "C")).toEqual({ ok: false, error: "選択肢にない値です" });
    });

    it("文字列以外はエラー", () => {
      const d = def({ fieldType: "select", options: ["A"] });
      expect(validateValue(d, 1)).toEqual({ ok: false, error: "選択肢から選んでください" });
    });
  });

  describe("boolean", () => {
    it("true / false はそのまま", () => {
      expect(validateValue(def({ fieldType: "boolean" }), true)).toEqual({
        ok: true,
        value: true,
      });
      expect(validateValue(def({ fieldType: "boolean" }), false)).toEqual({
        ok: true,
        value: false,
      });
    });

    it("文字列の 'true' は通らない(boolean に厳密)", () => {
      expect(validateValue(def({ fieldType: "boolean" }), "true")).toEqual({
        ok: false,
        error: "true / false を入力してください",
      });
    });
  });
});

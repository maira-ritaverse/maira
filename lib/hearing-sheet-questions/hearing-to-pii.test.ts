import { describe, expect, it } from "vitest";

import { hearingSheetToResumePii } from "./hearing-to-pii";
import type { HearingQuestionDefinition, HearingPiiTarget } from "./types";

/** テスト用に最小限の質問定義を作る。 */
function q(key: string, mapsToPii: HearingPiiTarget | null): HearingQuestionDefinition {
  return {
    id: `id-${key}`,
    organizationId: "org",
    key,
    label: key,
    helpText: null,
    inputType: "textarea",
    maxLength: 2000,
    mapsToPii,
    displayOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
}

describe("hearingSheetToResumePii", () => {
  it("content が null なら空パッチ", () => {
    expect(hearingSheetToResumePii([q("a", "full_name")], null)).toEqual({ patch: {}, count: 0 });
  });

  it("maps_to_pii 未設定・空回答は無視する", () => {
    const questions = [q("memo", null), q("name", "full_name")];
    const { patch, count } = hearingSheetToResumePii(questions, { memo: "x", name: "  " });
    expect(patch).toEqual({});
    expect(count).toBe(0);
  });

  it("文字列項目を流し込み、最大長でクランプする", () => {
    const questions = [q("name", "full_name"), q("mail", "email")];
    const longName = "あ".repeat(150);
    const { patch, count } = hearingSheetToResumePii(questions, {
      name: longName,
      mail: "a@example.com",
    });
    expect(patch.full_name).toHaveLength(100); // full_name は max 100
    expect(patch.email).toBe("a@example.com");
    expect(count).toBe(2);
  });

  it("生年月日を YYYY-MM-DD に正規化(複数フォーマット)", () => {
    const questions = [q("bd", "birth_date")];
    expect(hearingSheetToResumePii(questions, { bd: "2000/1/2" }).patch.birth_date).toBe(
      "2000-01-02",
    );
    expect(hearingSheetToResumePii(questions, { bd: "1995年12月31日" }).patch.birth_date).toBe(
      "1995-12-31",
    );
    expect(hearingSheetToResumePii(questions, { bd: "2000-05-09" }).patch.birth_date).toBe(
      "2000-05-09",
    );
  });

  it("解釈できない生年月日はスキップ(誤った値を入れない)", () => {
    const questions = [q("bd", "birth_date")];
    const { patch, count } = hearingSheetToResumePii(questions, { bd: "だいたい90年代" });
    expect(patch.birth_date).toBeUndefined();
    expect(count).toBe(0);
  });

  it("不正な月日はスキップ", () => {
    const questions = [q("bd", "birth_date")];
    expect(
      hearingSheetToResumePii(questions, { bd: "2000/13/40" }).patch.birth_date,
    ).toBeUndefined();
  });

  it("性別を enum に best-effort 変換", () => {
    const questions = [q("g", "gender")];
    expect(hearingSheetToResumePii(questions, { g: "女性" }).patch.gender).toBe("female");
    expect(hearingSheetToResumePii(questions, { g: "男" }).patch.gender).toBe("male");
    expect(hearingSheetToResumePii(questions, { g: "その他" }).patch.gender).toBe("other");
  });

  it("判定できない性別はスキップ", () => {
    const questions = [q("g", "gender")];
    const { patch, count } = hearingSheetToResumePii(questions, { g: "回答なし" });
    expect(patch.gender).toBeUndefined();
    expect(count).toBe(0);
  });
});

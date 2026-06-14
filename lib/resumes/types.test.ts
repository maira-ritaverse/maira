import { describe, it, expect } from "vitest";
import {
  educationItemSchema,
  genderLabels,
  licenseItemSchema,
  saveResumeRequestSchema,
  type Gender,
} from "./types";

/**
 * 履歴書スキーマのテスト。
 *
 * 「途中まで入力して保存」(下書き)を許容する設計が要なので、必須項目は title のみ。
 * その他は空文字 / 省略を許容する契約が、各フィールドで一貫して維持されていることを確認。
 *
 * 学歴・資格は year/month に null 許容(月だけ未確定の下書き対応)。
 * 1950〜2100 の境界は「年号バー」「明治」レベルを除く実用範囲という設計判断。
 */

const ALL_GENDERS: Gender[] = ["male", "female", "unspecified"];

describe("genderLabels", () => {
  it("全 Gender にラベルがある", () => {
    for (const g of ALL_GENDERS) {
      expect(genderLabels[g]).toBeTruthy();
    }
  });

  it("union と Record のキーが一致", () => {
    expect(Object.keys(genderLabels).sort()).toEqual([...ALL_GENDERS].sort());
  });

  it("'unspecified' は '記入しない'(履歴書の様式に合わせた表現)", () => {
    expect(genderLabels.unspecified).toBe("記入しない");
  });
});

describe("educationItemSchema", () => {
  it("year/month が null でも通る(月だけ未確定の下書き対応)", () => {
    expect(
      educationItemSchema.safeParse({ year: null, month: null, description: "○○大学入学" }).success,
    ).toBe(true);
  });

  it("year 範囲 1950〜2100", () => {
    expect(
      educationItemSchema.safeParse({ year: 1950, month: null, description: "" }).success,
    ).toBe(true);
    expect(
      educationItemSchema.safeParse({ year: 2100, month: null, description: "" }).success,
    ).toBe(true);
    expect(
      educationItemSchema.safeParse({ year: 1949, month: null, description: "" }).success,
    ).toBe(false);
    expect(
      educationItemSchema.safeParse({ year: 2101, month: null, description: "" }).success,
    ).toBe(false);
  });

  it("month 範囲 1〜12", () => {
    expect(educationItemSchema.safeParse({ year: 2025, month: 1, description: "" }).success).toBe(
      true,
    );
    expect(educationItemSchema.safeParse({ year: 2025, month: 12, description: "" }).success).toBe(
      true,
    );
    expect(educationItemSchema.safeParse({ year: 2025, month: 0, description: "" }).success).toBe(
      false,
    );
    expect(educationItemSchema.safeParse({ year: 2025, month: 13, description: "" }).success).toBe(
      false,
    );
  });

  it("description は 200 文字までは OK / 201 で失敗", () => {
    expect(
      educationItemSchema.safeParse({
        year: null,
        month: null,
        description: "a".repeat(200),
      }).success,
    ).toBe(true);
    expect(
      educationItemSchema.safeParse({
        year: null,
        month: null,
        description: "a".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("year / month は整数のみ(小数は拒否)", () => {
    expect(
      educationItemSchema.safeParse({ year: 2025.5, month: null, description: "" }).success,
    ).toBe(false);
    expect(educationItemSchema.safeParse({ year: 2025, month: 6.5, description: "" }).success).toBe(
      false,
    );
  });
});

describe("licenseItemSchema", () => {
  it("year/month は null 許容、name 必須", () => {
    expect(
      licenseItemSchema.safeParse({ year: null, month: null, name: "TOEIC 800" }).success,
    ).toBe(true);
  });

  it("name は 200 文字までは OK / 201 で失敗", () => {
    expect(
      licenseItemSchema.safeParse({ year: null, month: null, name: "a".repeat(200) }).success,
    ).toBe(true);
    expect(
      licenseItemSchema.safeParse({ year: null, month: null, name: "a".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("saveResumeRequestSchema — 下書き許容", () => {
  it("title だけ + 配列 2 つで通る(その他は省略でも OK)", () => {
    const r = saveResumeRequestSchema.safeParse({
      title: "下書き",
      education_history: [],
      licenses: [],
    });
    expect(r.success).toBe(true);
  });

  it("title が空文字なら失敗", () => {
    expect(
      saveResumeRequestSchema.safeParse({
        title: "",
        education_history: [],
        licenses: [],
      }).success,
    ).toBe(false);
  });

  it("education_history / licenses は配列必須(undefined だと失敗)", () => {
    expect(
      saveResumeRequestSchema.safeParse({
        title: "x",
        licenses: [],
      }).success,
    ).toBe(false);
    expect(
      saveResumeRequestSchema.safeParse({
        title: "x",
        education_history: [],
      }).success,
    ).toBe(false);
  });
});

describe("saveResumeRequestSchema — 各フィールドの境界", () => {
  const base = { title: "x", education_history: [], licenses: [] };

  it("全テキスト系フィールドは空文字を許容(下書き対応)", () => {
    expect(
      saveResumeRequestSchema.safeParse({
        ...base,
        name: "",
        name_kana: "",
        birth_date: "",
        postal_code: "",
        address: "",
        phone: "",
        email: "",
        contact_address: "",
        document_date: "",
        motivation_note: "",
        personal_requests: "",
      }).success,
    ).toBe(true);
  });

  it("email が空文字なら OK、入力されていれば形式チェック", () => {
    expect(saveResumeRequestSchema.safeParse({ ...base, email: "" }).success).toBe(true);
    expect(saveResumeRequestSchema.safeParse({ ...base, email: "a@b.co" }).success).toBe(true);
    expect(saveResumeRequestSchema.safeParse({ ...base, email: "not-email" }).success).toBe(false);
  });

  it("gender は male/female/unspecified、null/省略を許容", () => {
    for (const g of ALL_GENDERS) {
      expect(saveResumeRequestSchema.safeParse({ ...base, gender: g }).success).toBe(true);
    }
    expect(saveResumeRequestSchema.safeParse({ ...base, gender: null }).success).toBe(true);
    expect(saveResumeRequestSchema.safeParse({ ...base }).success).toBe(true);
    expect(saveResumeRequestSchema.safeParse({ ...base, gender: "other" }).success).toBe(false);
  });

  it("title は 100 文字までは OK / 101 で失敗", () => {
    expect(saveResumeRequestSchema.safeParse({ ...base, title: "a".repeat(100) }).success).toBe(
      true,
    );
    expect(saveResumeRequestSchema.safeParse({ ...base, title: "a".repeat(101) }).success).toBe(
      false,
    );
  });

  it("motivation_note / personal_requests は 1000 文字境界", () => {
    expect(
      saveResumeRequestSchema.safeParse({ ...base, motivation_note: "a".repeat(1000) }).success,
    ).toBe(true);
    expect(
      saveResumeRequestSchema.safeParse({ ...base, motivation_note: "a".repeat(1001) }).success,
    ).toBe(false);
    expect(
      saveResumeRequestSchema.safeParse({ ...base, personal_requests: "a".repeat(1001) }).success,
    ).toBe(false);
  });

  it("address は 200 / phone は 20 / postal_code は 10 文字境界", () => {
    expect(saveResumeRequestSchema.safeParse({ ...base, address: "a".repeat(201) }).success).toBe(
      false,
    );
    expect(saveResumeRequestSchema.safeParse({ ...base, phone: "a".repeat(21) }).success).toBe(
      false,
    );
    expect(
      saveResumeRequestSchema.safeParse({ ...base, postal_code: "a".repeat(11) }).success,
    ).toBe(false);
  });

  it("education_history の各要素にもバリデーション(year 範囲外で失敗)", () => {
    expect(
      saveResumeRequestSchema.safeParse({
        ...base,
        education_history: [{ year: 1900, month: null, description: "" }],
      }).success,
    ).toBe(false);
  });
});

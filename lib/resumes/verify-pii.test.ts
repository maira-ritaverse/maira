import { describe, it, expect } from "vitest";
import { pickResumePii, type ResumePii } from "./pii-fields";
import {
  compareRowToBlob,
  summarizeDiffs,
  type ResumeRowForVerify,
  type RowDiff,
} from "./verify-pii";

function rowFrom(overrides: Partial<ResumeRowForVerify> = {}): ResumeRowForVerify {
  return {
    id: "r-1",
    name: null,
    name_kana: null,
    birth_date: null,
    gender: null,
    postal_code: null,
    address: null,
    address_kana: null,
    phone: null,
    email: null,
    contact_address: null,
    contact_address_kana: null,
    contact_phone: null,
    photo_url: null,
    education_history: [],
    licenses: [],
    motivation_note: null,
    personal_requests: null,
    ...overrides,
  };
}

describe("verify-pii.compareRowToBlob", () => {
  describe("一致パターン(差分なしを返す)", () => {
    it("全フィールドが揃った行と一致する blob → 差分 0", () => {
      const row = rowFrom({
        name: "山田 太郎",
        name_kana: "やまだ たろう",
        birth_date: "1995-04-12",
        gender: "male",
        postal_code: "100-0001",
        address: "東京都千代田区千代田1-1",
        address_kana: "とうきょうとちよだくちよだ",
        phone: "090-1234-5678",
        email: "taro@example.com",
        contact_address: "東京都港区赤坂1-1-1",
        contact_address_kana: "とうきょうとみなとくあかさか",
        contact_phone: "03-1234-5678",
        photo_url: "https://example.com/photo.png",
        education_history: [{ year: 2017, month: 3, description: "卒業" }],
        licenses: [{ year: 2018, month: 6, name: "免許" }],
        motivation_note: "志望動機",
        personal_requests: "希望",
      });
      const blob = pickResumePii({ ...row });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("空っぽの行と空 PII → 差分 0", () => {
      const row = rowFrom();
      const blob = pickResumePii({});
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });
  });

  describe("scalar の null / 空文字の同値扱い", () => {
    it('row が "" / blob が null → 同値とみなす', () => {
      const row = rowFrom({ name: "" });
      const blob = pickResumePii({ name: null });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it('row が "  " (空白だけ) / blob が null → 同値', () => {
      const row = rowFrom({ phone: "   " });
      const blob = pickResumePii({ phone: null });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("値が違う scalar は value_mismatch を返す", () => {
      const row = rowFrom({ name: "山田" });
      const blob = pickResumePii({ name: "鈴木" });
      const diffs = compareRowToBlob(row, blob);
      expect(diffs).toEqual([{ field: "name", kind: "value_mismatch" }]);
    });
  });

  describe("birth_date の date↔ISO 文字列正規化", () => {
    it('両方 "YYYY-MM-DD" 文字列で一致 → 差分 0', () => {
      const row = rowFrom({ birth_date: "1995-04-12" });
      const blob = pickResumePii({ birth_date: "1995-04-12" });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("文字列の前後空白は無視される", () => {
      const row = rowFrom({ birth_date: " 1995-04-12 " });
      const blob = pickResumePii({ birth_date: "1995-04-12" });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it('両方とも未設定 (null と "") → 同値', () => {
      const row = rowFrom({ birth_date: "" });
      const blob = pickResumePii({ birth_date: null });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("日付が違えば検出する", () => {
      const row = rowFrom({ birth_date: "1995-04-12" });
      const blob = pickResumePii({ birth_date: "1995-04-13" });
      const diffs = compareRowToBlob(row, blob);
      expect(diffs).toEqual([{ field: "birth_date", kind: "value_mismatch" }]);
    });
  });

  describe("gender の enum 比較", () => {
    it("row=male / blob=male → 同値", () => {
      const row = rowFrom({ gender: "male" });
      const blob = pickResumePii({ gender: "male" });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("row の不正値は null として扱い、blob=null と同値とみなす", () => {
      const row = rowFrom({ gender: "garbage" });
      const blob = pickResumePii({ gender: null });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("row=male / blob=female → 検出", () => {
      const row = rowFrom({ gender: "male" });
      const blob = pickResumePii({ gender: "female" });
      const diffs = compareRowToBlob(row, blob);
      expect(diffs).toEqual([{ field: "gender", kind: "value_mismatch" }]);
    });
  });

  describe("jsonb(education_history / licenses)の深い比較", () => {
    it("配列内容が完全一致 → 差分 0", () => {
      const items = [{ year: 2017, month: 3, description: "卒業" }];
      const row = rowFrom({ education_history: items });
      const blob = pickResumePii({ education_history: items });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("row に zod スキーマ違反の壊れた要素が混ざっていれば、blob は要素を落とすので差分検出する(これは緩めない)", () => {
      const rowItems = [
        { year: 2017, month: 3, description: "卒業" },
        { year: "bad", month: 3, description: "壊れた" }, // pickResumePii が落とす
      ];
      const row = rowFrom({ education_history: rowItems });
      // blob は pickResumePii を経由して 1 件になる
      const blob = pickResumePii({ education_history: rowItems });
      expect(blob.education_history).toHaveLength(1);
      const diffs = compareRowToBlob(row, blob);
      // 差分 1 件(education_history: value_mismatch)
      expect(diffs).toEqual([{ field: "education_history", kind: "value_mismatch" }]);
    });

    it("並び順が違えば検出する(意図的な並び替えも差分とみなす)", () => {
      const a = { year: 2017, month: 3, description: "A" };
      const b = { year: 2018, month: 4, description: "B" };
      const row = rowFrom({ education_history: [a, b] });
      const blob = pickResumePii({ education_history: [b, a] });
      const diffs = compareRowToBlob(row, blob);
      expect(diffs).toEqual([{ field: "education_history", kind: "value_mismatch" }]);
    });

    it("licenses も同様に深く比較する", () => {
      const row = rowFrom({ licenses: [{ year: 2018, month: 6, name: "免許A" }] });
      const blob = pickResumePii({ licenses: [{ year: 2018, month: 6, name: "免許B" }] });
      const diffs = compareRowToBlob(row, blob);
      expect(diffs).toEqual([{ field: "licenses", kind: "value_mismatch" }]);
    });

    it("空配列同士は一致", () => {
      const row = rowFrom({ education_history: [] });
      const blob = pickResumePii({ education_history: [] });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("row 側に react-hook-form 由来の余分なキー(id 等)が混ざっていても差分にしない(データ消失ではないため)", () => {
      // useFieldArray が付ける `id` フィールドは zod スキーマに無いので
      // pickResumePii で剥がされる。要素数は変わらないので「真の差分」ではない。
      const rowItems = [{ id: "rhf-uuid-1", year: 2017, month: 3, description: "卒業" }];
      const row = rowFrom({ education_history: rowItems });
      // blob は (id を持たない) 正規化後の値を保持している
      const blob = pickResumePii({ education_history: rowItems });
      expect(blob.education_history).toEqual([{ year: 2017, month: 3, description: "卒業" }]);
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });

    it("licenses でも余分なキーは差分にしない", () => {
      const rowItems = [{ id: "x", year: 2018, month: 6, name: "免許" }];
      const row = rowFrom({ licenses: rowItems });
      const blob = pickResumePii({ licenses: rowItems });
      expect(compareRowToBlob(row, blob)).toEqual([]);
    });
  });

  describe("複数の差分を一度に検出", () => {
    it("3 つの差分(scalar / date / jsonb)を全部返す", () => {
      const row = rowFrom({
        name: "山田",
        birth_date: "1995-04-12",
        education_history: [{ year: 2017, month: 3, description: "卒業" }],
      });
      const blob: ResumePii = pickResumePii({
        name: "鈴木",
        birth_date: "1995-04-13",
        education_history: [],
      });
      const diffs = compareRowToBlob(row, blob);
      expect(diffs).toEqual(
        expect.arrayContaining([
          { field: "name", kind: "value_mismatch" },
          { field: "birth_date", kind: "value_mismatch" },
          { field: "education_history", kind: "value_mismatch" },
        ]),
      );
      expect(diffs).toHaveLength(3);
    });
  });
});

describe("verify-pii.summarizeDiffs", () => {
  it("複数行の差分を field:kind ごとに集計する", () => {
    const rowDiffs: RowDiff[] = [
      { rowId: "r1", diffs: [{ field: "name", kind: "value_mismatch" }] },
      {
        rowId: "r2",
        diffs: [
          { field: "name", kind: "value_mismatch" },
          { field: "email", kind: "value_mismatch" },
        ],
      },
    ];
    expect(summarizeDiffs(rowDiffs)).toEqual({
      "name:value_mismatch": 2,
      "email:value_mismatch": 1,
    });
  });

  it("空配列は空サマリ", () => {
    expect(summarizeDiffs([])).toEqual({});
  });
});

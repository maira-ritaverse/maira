import { describe, it, expect } from "vitest";
import {
  countLabourFieldsFilled,
  formatSalaryRange,
  LABOUR_FIELDS_TOTAL,
  type JobPosting,
} from "./types";

// テスト用のベース JobPosting。法定 8 列を全て null にしておき、各テストで差分を上書きする。
const BASE: JobPosting = {
  id: "job-1",
  organizationId: "org-1",
  companyName: "テスト株式会社",
  position: "テストポジション",
  employmentType: null,
  location: null,
  salaryMin: null,
  salaryMax: null,
  description: null,
  requiredSkills: null,
  preferredSkills: null,
  status: "open",
  workChangeScope: null,
  locationChangeScope: null,
  smokingPreventionMeasure: null,
  probationPeriod: null,
  workHours: null,
  breakTime: null,
  holidays: null,
  applicationQualifications: null,
  createdByMemberId: null,
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

/**
 * 年収レンジ表示の純粋関数テスト。
 *
 * 求人一覧・詳細・カードなどで広く使われる表示用関数。
 * 4 つの分岐(両方あり / 下限のみ / 上限のみ / 両方なし)を網羅する。
 *
 * 仕様(types.ts より):
 *   - 両方あり: "500〜700万円"
 *   - 下限のみ: "500万円〜"
 *   - 上限のみ: "〜700万円"
 *   - どちらもなし: "応相談"
 */
describe("formatSalaryRange", () => {
  it("下限と上限の両方が指定されているとき範囲表示", () => {
    expect(formatSalaryRange(500, 700)).toBe("500〜700万円");
  });

  it("下限のみ指定されているとき「〜」付きで表示", () => {
    expect(formatSalaryRange(500, null)).toBe("500万円〜");
  });

  it("上限のみ指定されているとき「〜」前置きで表示", () => {
    expect(formatSalaryRange(null, 700)).toBe("〜700万円");
  });

  it("どちらも null なら「応相談」", () => {
    expect(formatSalaryRange(null, null)).toBe("応相談");
  });

  it("0 円(極端値)も number として扱う(null 扱いしない)", () => {
    // 「0万円〜0万円」を「応相談」に倒さないことの確認(数値 0 は falsy だが null ではない)
    expect(formatSalaryRange(0, 0)).toBe("0〜0万円");
  });

  it("下限=上限(同額)も範囲表示で出す", () => {
    // 「500万円固定」を「500〜500万円」と冗長に出す。重複圧縮はしない仕様。
    // UI 側で必要なら別途整形する責務分離。
    expect(formatSalaryRange(500, 500)).toBe("500〜500万円");
  });

  it("下限が上限より大きい(運用ミス)場合もそのまま表示する", () => {
    // バリデーションは Zod 側で行う想定。ここは表示用なので入力に介入しない。
    expect(formatSalaryRange(700, 500)).toBe("700〜500万円");
  });

  it("大きな金額(上限100000万円=10億)でも壊れない", () => {
    expect(formatSalaryRange(100000, 100000)).toBe("100000〜100000万円");
  });
});

/**
 * 法定明示事項(8 列)の入力完了数を数える純粋関数のテスト。
 *
 * 業務上は「未入力扱い」を統一する必要がある(null と空文字と空白のみ を同じく未入力)。
 */
describe("countLabourFieldsFilled", () => {
  it("総数定数は 8(マイグレーション 20260615000004 と対応)", () => {
    expect(LABOUR_FIELDS_TOTAL).toBe(8);
  });

  it("全て null なら 0", () => {
    expect(countLabourFieldsFilled(BASE)).toBe(0);
  });

  it("全て埋まっていれば 8", () => {
    expect(
      countLabourFieldsFilled({
        ...BASE,
        workChangeScope: "v",
        locationChangeScope: "v",
        smokingPreventionMeasure: "v",
        probationPeriod: "v",
        workHours: "v",
        breakTime: "v",
        holidays: "v",
        applicationQualifications: "v",
      }),
    ).toBe(8);
  });

  it("1 つだけ非空文字なら 1(他は null)", () => {
    expect(countLabourFieldsFilled({ ...BASE, workHours: "9:00-18:00" })).toBe(1);
  });

  it("空文字は未入力として数えない", () => {
    expect(countLabourFieldsFilled({ ...BASE, workHours: "" })).toBe(0);
  });

  it("空白のみ(スペース・タブ・改行)も未入力として数えない", () => {
    expect(
      countLabourFieldsFilled({
        ...BASE,
        workHours: "   ",
        breakTime: "\t\n  ",
      }),
    ).toBe(0);
  });

  it("有効値と空白の混在で、空白以外だけ数える", () => {
    expect(
      countLabourFieldsFilled({
        ...BASE,
        workHours: "9:00-18:00", // 有効
        breakTime: "", // 空文字
        holidays: "   ", // 空白のみ
        applicationQualifications: "Webアプリ3年以上", // 有効
      }),
    ).toBe(2);
  });
});

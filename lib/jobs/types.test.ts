import { describe, it, expect } from "vitest";
import {
  countLabourFieldsFilled,
  createJobRequestSchema,
  formatSalaryRange,
  LABOUR_FIELDS_TOTAL,
  updateJobRequestSchema,
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

/**
 * 求人作成・更新の zod スキーマテスト。
 *
 * salary_min/max の preprocessor(空文字 → null、文字列数値 → number)は
 * フォーム入力の挙動と DB の整数制約の橋渡しなので、境界値を明示的に固める。
 * labourField の「空文字 OK」も法定明示事項の段階的入力を許容する契約。
 */
describe("createJobRequestSchema", () => {
  const base = { company_name: "テスト株式会社", position: "エンジニア" };

  it("最小構成(company_name + position)で通る、status は default 'open'", () => {
    const r = createJobRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("open");
  });

  it("company_name / position が空文字なら失敗", () => {
    expect(createJobRequestSchema.safeParse({ ...base, company_name: "" }).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ ...base, position: "" }).success).toBe(false);
  });

  it("salary_min/max は数値・文字列数値・null・undefined・空文字を受け付ける", () => {
    // フォームの <input type="number"> 由来の "" を null に正規化する契約
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: 500 }).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: "500" }).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: null }).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: "" }).success).toBe(true);
  });

  it("salary は 0 を許容、負の値・上限超は失敗", () => {
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: 0 }).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: -1 }).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ ...base, salary_max: 100001 }).success).toBe(false);
    expect(createJobRequestSchema.safeParse({ ...base, salary_max: 100000 }).success).toBe(true);
  });

  it("salary に数値化できない文字列は失敗", () => {
    expect(createJobRequestSchema.safeParse({ ...base, salary_min: "abc" }).success).toBe(false);
  });

  it("status は open/paused/closed のみ", () => {
    for (const s of ["open", "paused", "closed"] as const) {
      expect(createJobRequestSchema.safeParse({ ...base, status: s }).success).toBe(true);
    }
    expect(createJobRequestSchema.safeParse({ ...base, status: "archived" }).success).toBe(false);
  });

  it("description は 12000 文字までは OK / 12001 文字で失敗", () => {
    // AI 抽出が ★ 区切りで 集約する 設計に した ため 5000 → 12000 に 拡張。
    expect(
      createJobRequestSchema.safeParse({ ...base, description: "a".repeat(12000) }).success,
    ).toBe(true);
    expect(
      createJobRequestSchema.safeParse({ ...base, description: "a".repeat(12001) }).success,
    ).toBe(false);
  });

  it("法定明示事項 8 列は空文字 OK / 4000 文字までは OK / 4001 で失敗", () => {
    // AI 抽出時に 集約 した holidays / application_qualifications 等が 2000 字 を
    // 超える ケースが あった ため 4000 字 に 拡張。
    expect(createJobRequestSchema.safeParse({ ...base, work_hours: "" }).success).toBe(true);
    expect(
      createJobRequestSchema.safeParse({ ...base, work_hours: "a".repeat(4000) }).success,
    ).toBe(true);
    expect(
      createJobRequestSchema.safeParse({ ...base, work_hours: "a".repeat(4001) }).success,
    ).toBe(false);
  });
});

describe("updateJobRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    expect(updateJobRequestSchema.safeParse({}).success).toBe(true);
  });

  it("company_name は省略可だが、与えるなら空文字不可", () => {
    expect(updateJobRequestSchema.safeParse({}).success).toBe(true);
    expect(updateJobRequestSchema.safeParse({ company_name: "" }).success).toBe(false);
    expect(updateJobRequestSchema.safeParse({ company_name: "X" }).success).toBe(true);
  });

  it("status は open/paused/closed のみ", () => {
    expect(updateJobRequestSchema.safeParse({ status: "open" }).success).toBe(true);
    expect(updateJobRequestSchema.safeParse({ status: "archived" }).success).toBe(false);
  });

  it("salary の preprocessor は更新スキーマでも同じ挙動", () => {
    expect(updateJobRequestSchema.safeParse({ salary_min: "" }).success).toBe(true);
    expect(updateJobRequestSchema.safeParse({ salary_min: null }).success).toBe(true);
    expect(updateJobRequestSchema.safeParse({ salary_min: 100001 }).success).toBe(false);
  });
});

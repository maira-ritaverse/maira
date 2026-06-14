import { describe, it, expect } from "vitest";
import { formatSalaryRange } from "./types";

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

import { describe, it, expect } from "vitest";
import {
  formatReferralStatusTransition,
  getReferralStatusConfig,
  referralStatusConfig,
  type ReferralStatus,
} from "./types";

/**
 * 紹介ステータス定義のテスト。
 *
 * referralStatusConfig は「DB の check 制約・画面表示・順序・色」を 1 箇所で
 * 管理する単一情報源。要素が増減すると画面の並びや色が崩れる、DB との整合が
 * 取れないなど影響範囲が広いので、構造そのものを assert する。
 *
 * getReferralStatusConfig / formatReferralStatusTransition は履歴表示で
 * 使われるので、想定外入力でのフォールバック挙動も検証。
 */

const ALL_STATUSES: ReferralStatus[] = [
  "planned",
  "recommended",
  "screening",
  "interview",
  "offer",
  "joined",
  "declined",
];

describe("referralStatusConfig", () => {
  it("全 ReferralStatus に対応する config が存在する(漏れがあると status バッジが落ちる)", () => {
    for (const status of ALL_STATUSES) {
      const found = referralStatusConfig.find((s) => s.value === status);
      expect(found, `${status} の config が無い`).toBeDefined();
    }
  });

  it("config の数と ReferralStatus union の要素数が一致する", () => {
    expect(referralStatusConfig).toHaveLength(ALL_STATUSES.length);
  });

  it("value 列に重複が無い(get で先頭が返って残りが見えないケースを防ぐ)", () => {
    const values = referralStatusConfig.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("label は全部非空(空ラベルだとバッジが見えなくなる)", () => {
    for (const s of referralStatusConfig) {
      expect(s.label.length, `${s.value} の label が空`).toBeGreaterThan(0);
    }
  });

  it("className は全部非空(色クラスが空だと無色になる)", () => {
    for (const s of referralStatusConfig) {
      expect(s.className.length, `${s.value} の className が空`).toBeGreaterThan(0);
    }
  });

  it("declined は order=99(本筋から外れて末尾扱い)", () => {
    const declined = referralStatusConfig.find((s) => s.value === "declined");
    expect(declined?.order).toBe(99);
  });

  it("declined 以外は order が 1〜6 で連番(進行順を担保)", () => {
    const orders = referralStatusConfig
      .filter((s) => s.value !== "declined")
      .map((s) => s.order)
      .sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("getReferralStatusConfig", () => {
  it("有効な status の config を返す", () => {
    expect(getReferralStatusConfig("planned").label).toBe("推薦予定");
    expect(getReferralStatusConfig("recommended").label).toBe("推薦済");
    expect(getReferralStatusConfig("offer").label).toBe("内定");
    expect(getReferralStatusConfig("joined").label).toBe("入社");
    expect(getReferralStatusConfig("declined").label).toBe("見送り");
  });

  it("想定外の値は planned にフォールバック(落ちない契約)", () => {
    // 型を意図的に外して落ちないことを検証
    const result = getReferralStatusConfig("unknown_status" as ReferralStatus);
    expect(result.value).toBe("planned");
  });

  it("空文字も planned にフォールバック", () => {
    const result = getReferralStatusConfig("" as ReferralStatus);
    expect(result.value).toBe("planned");
  });
});

describe("formatReferralStatusTransition", () => {
  it("from と to がある場合は '推薦予定 → 推薦済' 形式", () => {
    expect(formatReferralStatusTransition("planned", "recommended")).toBe("推薦予定 → 推薦済");
  });

  it("from が null なら to のラベルだけ返す(初回作成時)", () => {
    expect(formatReferralStatusTransition(null, "planned")).toBe("推薦予定");
    expect(formatReferralStatusTransition(null, "recommended")).toBe("推薦済");
  });

  it("status 進行の代表的なケース", () => {
    expect(formatReferralStatusTransition("recommended", "screening")).toBe("推薦済 → 書類選考");
    expect(formatReferralStatusTransition("screening", "interview")).toBe("書類選考 → 面接");
    expect(formatReferralStatusTransition("interview", "offer")).toBe("面接 → 内定");
    expect(formatReferralStatusTransition("offer", "joined")).toBe("内定 → 入社");
    expect(formatReferralStatusTransition("interview", "declined")).toBe("面接 → 見送り");
  });

  it("同じ status から同じ status への遷移も文字列にできる(運用上は起きないが落ちない)", () => {
    expect(formatReferralStatusTransition("offer", "offer")).toBe("内定 → 内定");
  });

  it("想定外の status はラベルが planned 扱いになる(落ちない)", () => {
    expect(formatReferralStatusTransition("unknown" as ReferralStatus, "offer")).toBe(
      "推薦予定 → 内定",
    );
  });
});

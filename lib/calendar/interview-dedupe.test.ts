import { describe, expect, it } from "vitest";

import {
  buildSuppressKeys,
  INTERVIEW_ROUND_LABEL,
  shouldSuppressReferral,
} from "./interview-dedupe";

describe("buildSuppressKeys", () => {
  it("空 入力 は 空 セット", () => {
    expect(buildSuppressKeys([]).size).toBe(0);
  });

  it("1 レコード → 前後 5 分 の 11 キー", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }]);
    // ±5 分 = 11 スロット (delta = -5..+5)
    expect(keys.size).toBe(11);
  });

  it("2 レコード の 範囲 が 重なる 場合 は 集合 で 重複 排除", () => {
    // 同じ referral の 3 分 差 → ±5 分 の 範囲 が 重なる
    const keys = buildSuppressKeys([
      { referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" },
      { referralId: "r1", scheduledAt: "2026-08-01T10:03:00Z" },
    ]);
    // 期待 は 11 + (11 - 8 重複) = 14 に なる はず
    // 10:00 の 5 分 前 = -5..+5 (11 個) + 10:03 の -5..+5 (11 個)
    // 重複 は 10:00 の -2..+5 と 10:03 の -5..+2 の 8 個
    // 合計 は 11 + 11 - 8 = 14
    expect(keys.size).toBe(14);
  });

  it("referralId が 違えば 独立 セット", () => {
    const keys = buildSuppressKeys([
      { referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" },
      { referralId: "r2", scheduledAt: "2026-08-01T10:00:00Z" },
    ]);
    expect(keys.size).toBe(22);
  });

  it("不正 な ISO は skip", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "not-a-date" }]);
    expect(keys.size).toBe(0);
  });

  it("toleranceMinutes = 0 なら 1 分 単位 で 完全 一致 のみ", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }], 0);
    expect(keys.size).toBe(1);
  });
});

describe("shouldSuppressReferral", () => {
  it("interview_round と 一致 する referrals は 抑制", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }]);
    expect(
      shouldSuppressReferral({ id: "r1", scheduledInterviewAt: "2026-08-01T10:00:00Z" }, keys),
    ).toBe(true);
  });

  it("± 5 分 以内 なら 抑制 (揺れ 許容)", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }]);
    expect(
      shouldSuppressReferral({ id: "r1", scheduledInterviewAt: "2026-08-01T10:04:00Z" }, keys),
    ).toBe(true);
  });

  it("6 分 差 は 抑制 されない (範囲 外)", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }]);
    expect(
      shouldSuppressReferral({ id: "r1", scheduledInterviewAt: "2026-08-01T10:06:00Z" }, keys),
    ).toBe(false);
  });

  it("referral_id が 違えば 抑制 されない", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }]);
    expect(
      shouldSuppressReferral({ id: "r2", scheduledInterviewAt: "2026-08-01T10:00:00Z" }, keys),
    ).toBe(false);
  });

  it("不正 ISO の referral は 抑制 なし", () => {
    const keys = buildSuppressKeys([{ referralId: "r1", scheduledAt: "2026-08-01T10:00:00Z" }]);
    expect(shouldSuppressReferral({ id: "r1", scheduledInterviewAt: "invalid" }, keys)).toBe(false);
  });
});

describe("INTERVIEW_ROUND_LABEL", () => {
  it("5 kind すべて が 日本語 に マップ される", () => {
    expect(INTERVIEW_ROUND_LABEL.first).toBe("1次");
    expect(INTERVIEW_ROUND_LABEL.second).toBe("2次");
    expect(INTERVIEW_ROUND_LABEL.final).toBe("最終");
    expect(INTERVIEW_ROUND_LABEL.offer).toBe("内定");
    expect(INTERVIEW_ROUND_LABEL.company).toBe("企業");
  });
});

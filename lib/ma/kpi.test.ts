import { describe, it, expect } from "vitest";
import { aggregateOverallSendStats, calculateDeliveryRate } from "./kpi";

/**
 * MA 全体 KPI の計算テスト。
 *
 * 「成功 / 失敗 / スキップ」「配信率」を scenario-list の上部に表示する。
 * 配信率の分母に skipped を含めない契約は運用上の意味が大きいので、明示テスト。
 */

describe("aggregateOverallSendStats", () => {
  it("空 Map なら {sent:0, failed:0, skipped:0}", () => {
    expect(aggregateOverallSendStats({})).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("1 シナリオ分をそのまま返す", () => {
    expect(aggregateOverallSendStats({ s1: { sent: 5, failed: 2, skipped: 1 } })).toEqual({
      sent: 5,
      failed: 2,
      skipped: 1,
    });
  });

  it("複数シナリオを合算する", () => {
    const result = aggregateOverallSendStats({
      s1: { sent: 5, failed: 2, skipped: 1 },
      s2: { sent: 3, failed: 0, skipped: 4 },
      s3: { sent: 10, failed: 1, skipped: 0 },
    });
    expect(result).toEqual({ sent: 18, failed: 3, skipped: 5 });
  });

  it("全て 0 の値が並んでも 0 で返す(エッジケース)", () => {
    expect(
      aggregateOverallSendStats({
        s1: { sent: 0, failed: 0, skipped: 0 },
        s2: { sent: 0, failed: 0, skipped: 0 },
      }),
    ).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });
});

describe("calculateDeliveryRate", () => {
  it("sent + failed = 0 なら null(分母ゼロ→データなし)", () => {
    expect(calculateDeliveryRate({ sent: 0, failed: 0, skipped: 0 })).toBeNull();
    expect(calculateDeliveryRate({ sent: 0, failed: 0, skipped: 100 })).toBeNull();
    // skipped はいくらあっても分母に入れないので 100% にならない
  });

  it("全部 sent なら 100%", () => {
    expect(calculateDeliveryRate({ sent: 10, failed: 0, skipped: 0 })).toBe(100);
  });

  it("全部 failed なら 0%", () => {
    expect(calculateDeliveryRate({ sent: 0, failed: 10, skipped: 0 })).toBe(0);
  });

  it("50/50 なら 50%", () => {
    expect(calculateDeliveryRate({ sent: 5, failed: 5, skipped: 0 })).toBe(50);
  });

  it("Math.round の挙動:0.5 は 1 に切り上がる(JS は banker's rounding ではなく away-from-zero)", () => {
    // sent=1 / (1+2) = 33.33% → 33
    expect(calculateDeliveryRate({ sent: 1, failed: 2, skipped: 0 })).toBe(33);
    // sent=2 / (2+1) = 66.66% → 67
    expect(calculateDeliveryRate({ sent: 2, failed: 1, skipped: 0 })).toBe(67);
  });

  it("skipped は配信率の分母に含めない(設計契約)", () => {
    // sent=8, failed=2, skipped=1000 → 8/(8+2) = 80% に変わらない
    expect(calculateDeliveryRate({ sent: 8, failed: 2, skipped: 1000 })).toBe(80);
  });

  it("95% 以上(緑表示しきい値)の境界もテスト", () => {
    // UI 側で 95 以上か未満かでバッジ色を変えている。境界値を明示。
    expect(calculateDeliveryRate({ sent: 95, failed: 5, skipped: 0 })).toBe(95);
    expect(calculateDeliveryRate({ sent: 94, failed: 6, skipped: 0 })).toBe(94);
  });
});

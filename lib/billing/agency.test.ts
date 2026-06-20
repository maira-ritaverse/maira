import { describe, expect, it } from "vitest";

import {
  computePrice,
  getAiBonusForTier,
  getEffectiveAiBonus,
  getEffectiveRecordingAccess,
  getRecordingQuotaForTier,
  hasRecordingAccessForTier,
  isInTrial,
  PLAN_AI_BONUS,
  PRICING,
  RECORDING_QUOTA_MONTHLY,
  trialDaysRemaining,
  type OrganizationPlan,
} from "./agency";

const buildPlan = (overrides: Partial<OrganizationPlan> = {}): OrganizationPlan => ({
  organizationId: "00000000-0000-0000-0000-000000000001",
  tier: "standard",
  cycle: "monthly",
  status: "trialing",
  trialStartedAt: "2026-06-01T00:00:00.000Z",
  trialEndsAt: "2026-07-01T00:00:00.000Z",
  trialUpgradeChoice: null,
  currentPeriodStart: "2026-06-01T00:00:00.000Z",
  currentPeriodEnd: "2026-07-01T00:00:00.000Z",
  nextBilledAt: null,
  canceledAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

describe("getAiBonusForTier", () => {
  it("standard / standard_rec は ボーナス なし", () => {
    expect(getAiBonusForTier("standard")).toBe(0);
    expect(getAiBonusForTier("standard_rec")).toBe(0);
  });
  it("standard_pro / standard_premium は +500", () => {
    expect(getAiBonusForTier("standard_pro")).toBe(PLAN_AI_BONUS);
    expect(getAiBonusForTier("standard_premium")).toBe(PLAN_AI_BONUS);
  });
});

describe("hasRecordingAccessForTier", () => {
  it("standard_rec / standard_premium で 有効", () => {
    expect(hasRecordingAccessForTier("standard_rec")).toBe(true);
    expect(hasRecordingAccessForTier("standard_premium")).toBe(true);
  });
  it("standard / standard_pro では 無効", () => {
    expect(hasRecordingAccessForTier("standard")).toBe(false);
    expect(hasRecordingAccessForTier("standard_pro")).toBe(false);
  });
});

describe("getRecordingQuotaForTier", () => {
  it("録音 有効プラン は 月 50 件", () => {
    expect(getRecordingQuotaForTier("standard_rec")).toBe(RECORDING_QUOTA_MONTHLY);
    expect(getRecordingQuotaForTier("standard_premium")).toBe(RECORDING_QUOTA_MONTHLY);
  });
  it("録音 なしプラン は 0 件", () => {
    expect(getRecordingQuotaForTier("standard")).toBe(0);
    expect(getRecordingQuotaForTier("standard_pro")).toBe(0);
  });
});

describe("isInTrial / trialDaysRemaining", () => {
  it("trialing で 未来 終了 → true", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const plan = buildPlan({ status: "trialing", trialEndsAt: "2026-07-01T00:00:00.000Z" });
    expect(isInTrial(plan, now)).toBe(true);
    expect(trialDaysRemaining(plan, now)).toBe(16);
  });

  it("status=active → false (たとえ trial_ends_at が 未来 でも)", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const plan = buildPlan({ status: "active", trialEndsAt: "2026-07-01T00:00:00.000Z" });
    expect(isInTrial(plan, now)).toBe(false);
    expect(trialDaysRemaining(plan, now)).toBe(0);
  });

  it("trial_ends_at が 過去 → false", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const plan = buildPlan({ status: "trialing", trialEndsAt: "2026-07-01T00:00:00.000Z" });
    expect(isInTrial(plan, now)).toBe(false);
    expect(trialDaysRemaining(plan, now)).toBe(0);
  });
});

describe("getEffectiveAiBonus", () => {
  it("トライアル中 は 常に +500 (standard でも)", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const plan = buildPlan({ status: "trialing", tier: "standard" });
    expect(getEffectiveAiBonus(plan, now)).toBe(PLAN_AI_BONUS);
  });

  it("トライアル外 + standard → 0", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    const plan = buildPlan({ status: "active", tier: "standard" });
    expect(getEffectiveAiBonus(plan, now)).toBe(0);
  });

  it("トライアル外 + Pro → +500", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    const plan = buildPlan({ status: "active", tier: "standard_pro" });
    expect(getEffectiveAiBonus(plan, now)).toBe(PLAN_AI_BONUS);
  });
});

describe("getEffectiveRecordingAccess", () => {
  it("トライアル中 は 全プラン true", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    expect(
      getEffectiveRecordingAccess(buildPlan({ status: "trialing", tier: "standard" }), now),
    ).toBe(true);
  });
  it("トライアル外 + 録音 / Premium のみ true", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(
      getEffectiveRecordingAccess(buildPlan({ status: "active", tier: "standard_rec" }), now),
    ).toBe(true);
    expect(
      getEffectiveRecordingAccess(buildPlan({ status: "active", tier: "standard_premium" }), now),
    ).toBe(true);
    expect(
      getEffectiveRecordingAccess(buildPlan({ status: "active", tier: "standard" }), now),
    ).toBe(false);
    expect(
      getEffectiveRecordingAccess(buildPlan({ status: "active", tier: "standard_pro" }), now),
    ).toBe(false);
  });
});

describe("computePrice", () => {
  it("3 人 以下 / Standard → 基本 ¥25,000 のみ", () => {
    const p = computePrice("standard", 3);
    expect(p.base).toBe(PRICING.baseMonthly);
    expect(p.perSeatExtra).toBe(0);
    expect(p.upgrade).toBe(0);
    expect(p.monthlyTotal).toBe(25_000);
  });

  it("5 人 / Standard → ¥25,000 + ¥3,980 × 2", () => {
    const p = computePrice("standard", 5);
    expect(p.perSeatExtra).toBe(7_960);
    expect(p.monthlyTotal).toBe(32_960);
  });

  it("5 人 / Premium → ¥25,000 + ¥7,960 + ¥12,000 = ¥44,960", () => {
    const p = computePrice("standard_premium", 5);
    expect(p.monthlyTotal).toBe(44_960);
  });

  it("5 人 / Premium 年払い → 10% OFF", () => {
    const p = computePrice("standard_premium", 5, "yearly");
    expect(p.yearlyTotal).toBe(Math.round(44_960 * 12 * 0.9));
    expect(p.yearlyMonthlyEquivalent).toBe(Math.round((44_960 * 12 * 0.9) / 12));
    expect(p.monthlyTotal).toBe(p.yearlyMonthlyEquivalent);
  });

  it("0 人 / 負の人数 でも crash しない (= 基本 のみ)", () => {
    expect(computePrice("standard", 0).monthlyTotal).toBe(25_000);
    expect(computePrice("standard", -5).monthlyTotal).toBe(25_000);
  });

  it("10 人 / Pro → ¥25,000 + ¥3,980 × 7 + ¥4,200 = ¥57,060", () => {
    const p = computePrice("standard_pro", 10);
    expect(p.monthlyTotal).toBe(25_000 + 3_980 * 7 + 4_200);
  });
});

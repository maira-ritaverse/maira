import { describe, expect, it } from "vitest";

import {
  AI_TOTAL_STANDARD_MONTHLY,
  AI_TOTAL_STANDARD_PRO_MONTHLY,
  AI_TOTAL_TRIAL_MONTHLY,
  AI_TOTAL_UNPLANNED_MONTHLY,
  getAiTotalLimitByTier,
  getAiTotalLimitForPlan,
} from "./tier-limits";

describe("tier-limits 定数", () => {
  it("Standard の 月次 上限 は 500", () => {
    expect(AI_TOTAL_STANDARD_MONTHLY).toBe(500);
  });

  it("Standard Pro の 月次 上限 は 1000", () => {
    expect(AI_TOTAL_STANDARD_PRO_MONTHLY).toBe(1000);
  });

  it("トライアル 中 の 月次 上限 は Pro 相当 (1000)", () => {
    expect(AI_TOTAL_TRIAL_MONTHLY).toBe(1000);
  });

  it("プラン 未 開始 は Standard 相当 (500)", () => {
    expect(AI_TOTAL_UNPLANNED_MONTHLY).toBe(500);
  });
});

describe("getAiTotalLimitByTier", () => {
  it("standard は 500", () => {
    expect(getAiTotalLimitByTier("standard")).toBe(500);
  });

  it("standard_rec は 500 (現時点 は Standard 扱い)", () => {
    expect(getAiTotalLimitByTier("standard_rec")).toBe(500);
  });

  it("standard_pro は 1000", () => {
    expect(getAiTotalLimitByTier("standard_pro")).toBe(1000);
  });

  it("standard_premium は 1000 (Pro を 内包 想定)", () => {
    expect(getAiTotalLimitByTier("standard_premium")).toBe(1000);
  });
});

describe("getAiTotalLimitForPlan", () => {
  const now = new Date("2026-07-03T12:00:00Z");

  it("トライアル 中 は tier に よらず 1000 (Pro 相当)", () => {
    const plan = {
      tier: "standard" as const,
      status: "trialing" as const,
      trialEndsAt: "2026-07-30T00:00:00Z",
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(1000);
  });

  it("トライアル 期限 切れ 後 は tier 通り (standard=500)", () => {
    const plan = {
      tier: "standard" as const,
      status: "trialing" as const,
      trialEndsAt: "2026-06-30T00:00:00Z",
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(500);
  });

  it("active + standard は 500", () => {
    const plan = {
      tier: "standard" as const,
      status: "active" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(500);
  });

  it("active + standard_pro は 1000", () => {
    const plan = {
      tier: "standard_pro" as const,
      status: "active" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(1000);
  });

  it("免除 (is_billing_exempt=true) は tier 通り (現時点 の 方針)", () => {
    const plan = {
      tier: "standard" as const,
      status: "active" as const,
      trialEndsAt: null,
      isBillingExempt: true,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(500);
  });

  it("past_due の standard_pro は 1000 (課金 停止 直前 でも 上限 は 維持)", () => {
    const plan = {
      tier: "standard_pro" as const,
      status: "past_due" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(1000);
  });

  it("canceled は tier 通り (期末 まで 使える 想定)", () => {
    const plan = {
      tier: "standard_pro" as const,
      status: "canceled" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(1000);
  });

  it("トライアル 中 で 期限 が null な ら tier 通り (境界)", () => {
    const plan = {
      tier: "standard_pro" as const,
      status: "trialing" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(1000);
  });
});

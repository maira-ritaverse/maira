import { describe, expect, it } from "vitest";

import {
  AI_TOTAL_SOLO_MONTHLY,
  AI_TOTAL_SOLO_PRO_MONTHLY,
  AI_TOTAL_SOLO_TRIAL_MONTHLY,
  AI_TOTAL_STANDARD_MONTHLY,
  AI_TOTAL_STANDARD_PRO_MONTHLY,
  AI_TOTAL_TRIAL_MONTHLY,
  AI_TOTAL_UNPLANNED_MONTHLY,
  getAiTotalLimitByTier,
  getAiTotalLimitForPlan,
  isSoloTier,
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

  it("Solo の 月次 上限 は 100 (個人 プラン)", () => {
    expect(AI_TOTAL_SOLO_MONTHLY).toBe(100);
  });

  it("Solo Pro の 月次 上限 は 200 (Solo + 100)", () => {
    expect(AI_TOTAL_SOLO_PRO_MONTHLY).toBe(200);
  });

  it("Solo トライアル 中 の 月次 上限 は Solo Pro 相当 (200)", () => {
    // Team 系 の Trial 1000 を Solo に 適用 する と 意味 を なさない ため 別値。
    expect(AI_TOTAL_SOLO_TRIAL_MONTHLY).toBe(200);
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

  it("solo は 100 (個人 プラン、 経済 保護 の 根幹)", () => {
    expect(getAiTotalLimitByTier("solo")).toBe(100);
  });

  it("solo_pro は 200 (Solo + 100 の 拡張)", () => {
    expect(getAiTotalLimitByTier("solo_pro")).toBe(200);
  });
});

describe("isSoloTier", () => {
  it("solo / solo_pro は true", () => {
    expect(isSoloTier("solo")).toBe(true);
    expect(isSoloTier("solo_pro")).toBe(true);
  });

  it("Team 系 tier は false", () => {
    expect(isSoloTier("standard")).toBe(false);
    expect(isSoloTier("standard_rec")).toBe(false);
    expect(isSoloTier("standard_pro")).toBe(false);
    expect(isSoloTier("standard_premium")).toBe(false);
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

  // ─── Solo プラン (Phase A #1 で 追加) ─────────────────────────
  it("active + solo は 100 (個人 プラン)", () => {
    const plan = {
      tier: "solo" as const,
      status: "active" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(100);
  });

  it("active + solo_pro は 200 (Solo + 100 の 拡張)", () => {
    const plan = {
      tier: "solo_pro" as const,
      status: "active" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(200);
  });

  it("Solo トライアル 中 は Solo Pro 相当 (200)、 Team の 1000 は 適用 しない", () => {
    const plan = {
      tier: "solo" as const,
      status: "trialing" as const,
      trialEndsAt: "2026-07-30T00:00:00Z",
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(200);
  });

  it("Solo Pro トライアル 中 も Solo Pro 相当 (200)", () => {
    const plan = {
      tier: "solo_pro" as const,
      status: "trialing" as const,
      trialEndsAt: "2026-07-30T00:00:00Z",
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(200);
  });

  it("Solo トライアル 期限 切れ 後 は tier 通り (100)", () => {
    const plan = {
      tier: "solo" as const,
      status: "trialing" as const,
      trialEndsAt: "2026-06-30T00:00:00Z", // now より 前
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(100);
  });

  it("past_due の solo_pro は 200 (課金 停止 直前 でも 上限 は 維持)", () => {
    const plan = {
      tier: "solo_pro" as const,
      status: "past_due" as const,
      trialEndsAt: null,
      isBillingExempt: false,
    };
    expect(getAiTotalLimitForPlan(plan, now)).toBe(200);
  });
});

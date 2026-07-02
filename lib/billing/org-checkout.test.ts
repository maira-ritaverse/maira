import { describe, expect, it } from "vitest";

import { checkoutBodySchema, isCheckoutBlockedByStatus } from "./org-checkout";

describe("checkoutBodySchema", () => {
  it("standard × monthly を 受理", () => {
    expect(checkoutBodySchema.safeParse({ tier: "standard", cycle: "monthly" }).success).toBe(true);
  });

  it("standard_pro × yearly を 受理", () => {
    expect(checkoutBodySchema.safeParse({ tier: "standard_pro", cycle: "yearly" }).success).toBe(
      true,
    );
  });

  it("standard_rec は 拒否 (現時点 未 販売)", () => {
    expect(checkoutBodySchema.safeParse({ tier: "standard_rec", cycle: "monthly" }).success).toBe(
      false,
    );
  });

  it("standard_premium は 拒否", () => {
    expect(
      checkoutBodySchema.safeParse({ tier: "standard_premium", cycle: "monthly" }).success,
    ).toBe(false);
  });

  it("cycle が weekly は 拒否", () => {
    expect(checkoutBodySchema.safeParse({ tier: "standard", cycle: "weekly" }).success).toBe(false);
  });
});

describe("isCheckoutBlockedByStatus", () => {
  it("null (未 契約) は 許可", () => {
    expect(isCheckoutBlockedByStatus(null)).toEqual({ blocked: false });
  });

  it("undefined も 許可", () => {
    expect(isCheckoutBlockedByStatus(undefined)).toEqual({ blocked: false });
  });

  it("trialing は already_subscribed で 拒否", () => {
    expect(isCheckoutBlockedByStatus("trialing")).toEqual({
      blocked: true,
      reason: "already_subscribed",
    });
  });

  it("active も already_subscribed で 拒否", () => {
    expect(isCheckoutBlockedByStatus("active")).toEqual({
      blocked: true,
      reason: "already_subscribed",
    });
  });

  it("past_due は past_due で 拒否", () => {
    expect(isCheckoutBlockedByStatus("past_due")).toEqual({
      blocked: true,
      reason: "past_due",
    });
  });

  it("incomplete は incomplete で 拒否", () => {
    expect(isCheckoutBlockedByStatus("incomplete")).toEqual({
      blocked: true,
      reason: "incomplete",
    });
  });

  it("canceled は 再契約 許可", () => {
    expect(isCheckoutBlockedByStatus("canceled")).toEqual({ blocked: false });
  });
});

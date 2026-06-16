import { describe, expect, it } from "vitest";

import { isSubscribed, type NotificationPrefs } from "./prefs";

describe("isSubscribed", () => {
  it("null は全 ON 扱い", () => {
    expect(isSubscribed(null, "referral_status_change")).toBe(true);
  });

  it("空オブジェクトは全 ON 扱い(オプトアウト方式)", () => {
    expect(isSubscribed({}, "task_assigned")).toBe(true);
  });

  it("明示的 false のキーのみ false", () => {
    const prefs: NotificationPrefs = { referral_status_change: false };
    expect(isSubscribed(prefs, "referral_status_change")).toBe(false);
    expect(isSubscribed(prefs, "task_assigned")).toBe(true);
  });

  it("明示的 true は true", () => {
    expect(isSubscribed({ referral_status_change: true }, "referral_status_change")).toBe(true);
  });

  it("未指定キーは default 通り true", () => {
    expect(isSubscribed({ task_assigned: false }, "referral_status_change")).toBe(true);
  });
});

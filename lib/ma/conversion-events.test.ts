import { describe, expect, it } from "vitest";

import { referralStatusToEventKey } from "./conversion-events";

describe("referralStatusToEventKey", () => {
  it("interview → interview_started", () => {
    expect(referralStatusToEventKey("interview")).toBe("interview_started");
  });
  it("offer → offer_received", () => {
    expect(referralStatusToEventKey("offer")).toBe("offer_received");
  });
  it("joined → onboarded", () => {
    expect(referralStatusToEventKey("joined")).toBe("onboarded");
  });
  it("planned / recommended / screening / declined / 未知の値 は null", () => {
    for (const s of ["planned", "recommended", "screening", "declined", "unknown", ""]) {
      expect(referralStatusToEventKey(s)).toBeNull();
    }
  });
});

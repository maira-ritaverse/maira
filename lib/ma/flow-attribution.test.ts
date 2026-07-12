import { describe, expect, it } from "vitest";

import { CONVERSION_EVENT_LABELS, labelForConversionEvent } from "./flow-attribution";

describe("labelForConversionEvent", () => {
  it("既知の event_key は日本語に翻訳", () => {
    expect(labelForConversionEvent("meeting_confirmed")).toBe("面談確定");
    expect(labelForConversionEvent("offer_accepted")).toBe("内定承諾");
    expect(labelForConversionEvent("onboarded")).toBe("入社");
  });
  it("未知の event_key は原文をそのまま返す", () => {
    expect(labelForConversionEvent("custom_event")).toBe("custom_event");
  });
  it("既知ラベルには半角スペースが入っていない", () => {
    for (const label of Object.values(CONVERSION_EVENT_LABELS)) {
      expect(label).not.toMatch(/\s/);
    }
  });
});

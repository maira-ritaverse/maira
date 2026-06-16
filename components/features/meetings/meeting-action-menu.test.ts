import { describe, expect, it } from "vitest";

import { isMeetingImminent } from "./meeting-action-menu";

describe("isMeetingImminent", () => {
  const now = new Date("2026-07-01T10:00:00Z");

  it("15 分後の予定は imminent", () => {
    const start = new Date("2026-07-01T10:14:00Z").toISOString();
    expect(isMeetingImminent(start, now)).toBe(true);
  });

  it("ちょうど 15 分後は境界外(将来側)で false", () => {
    const start = new Date("2026-07-01T10:15:00Z").toISOString();
    expect(isMeetingImminent(start, now)).toBe(false);
  });

  it("30 分後の予定は imminent ではない", () => {
    const start = new Date("2026-07-01T10:30:00Z").toISOString();
    expect(isMeetingImminent(start, now)).toBe(false);
  });

  it("30 分前の予定もまだ imminent(会議中の可能性)", () => {
    const start = new Date("2026-07-01T09:30:00Z").toISOString();
    expect(isMeetingImminent(start, now)).toBe(true);
  });

  it("1 時間以上前の予定は imminent ではない(終了済み)", () => {
    const start = new Date("2026-07-01T08:00:00Z").toISOString();
    expect(isMeetingImminent(start, now)).toBe(false);
  });

  it("withinMinutes を変えれば判定が変わる", () => {
    const start = new Date("2026-07-01T10:25:00Z").toISOString();
    expect(isMeetingImminent(start, now, 15)).toBe(false);
    expect(isMeetingImminent(start, now, 30)).toBe(true);
  });
});

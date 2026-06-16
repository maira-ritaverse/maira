import { describe, expect, it } from "vitest";

import { createMeetingSchema } from "./meetings";

describe("createMeetingSchema", () => {
  const base = {
    provider: "zoom" as const,
    clientRecordId: "11111111-2222-3333-4444-555555555555",
    title: "○○さんと初回面談",
    agenda: "希望条件のヒアリング",
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    durationMinutes: 45,
  };

  it("正常系を通す", () => {
    const result = createMeetingSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("provider が zoom / google_meet 以外なら弾く", () => {
    const r = createMeetingSchema.safeParse({ ...base, provider: "teams" });
    expect(r.success).toBe(false);
  });

  it("title 空文字は不可", () => {
    const r = createMeetingSchema.safeParse({ ...base, title: "" });
    expect(r.success).toBe(false);
  });

  it("title 101 文字は不可", () => {
    const r = createMeetingSchema.safeParse({ ...base, title: "あ".repeat(101) });
    expect(r.success).toBe(false);
  });

  it("agenda は省略可、空文字も許容", () => {
    expect(createMeetingSchema.safeParse({ ...base, agenda: undefined }).success).toBe(true);
    expect(createMeetingSchema.safeParse({ ...base, agenda: "" }).success).toBe(true);
  });

  it("durationMinutes 5 未満は不可", () => {
    const r = createMeetingSchema.safeParse({ ...base, durationMinutes: 4 });
    expect(r.success).toBe(false);
  });

  it("durationMinutes 361 以上は不可", () => {
    const r = createMeetingSchema.safeParse({ ...base, durationMinutes: 361 });
    expect(r.success).toBe(false);
  });

  it("startsAt が過去(2 時間前)なら不可", () => {
    const r = createMeetingSchema.safeParse({
      ...base,
      startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("startsAt が ISO 8601 でないなら不可", () => {
    const r = createMeetingSchema.safeParse({ ...base, startsAt: "2026/07/01 10:00" });
    expect(r.success).toBe(false);
  });

  it("clientRecordId が UUID でないなら不可", () => {
    const r = createMeetingSchema.safeParse({ ...base, clientRecordId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});

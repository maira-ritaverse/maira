import { describe, expect, it } from "vitest";

import { buildCreateEventBody } from "./google-meet";
import { hasCalendarEventsScope } from "./google";

describe("buildCreateEventBody", () => {
  const baseInput = {
    summary: "面談 山田 太郎",
    startsAt: "2026-07-01T10:00:00+09:00",
    endsAt: "2026-07-01T10:45:00+09:00",
  };

  it("基本のフィールドが入る", () => {
    const body = buildCreateEventBody(baseInput);
    expect(body.summary).toBe("面談 山田 太郎");
    const start = body.start as { dateTime: string; timeZone: string };
    expect(start.dateTime).toBe("2026-07-01T10:00:00+09:00");
    expect(start.timeZone).toBe("Asia/Tokyo");
  });

  it("conferenceData.createRequest が含まれる(これが無いと Meet URL が発行されない)", () => {
    const body = buildCreateEventBody(baseInput);
    const cd = body.conferenceData as Record<string, unknown>;
    const cr = cd.createRequest as Record<string, unknown>;
    expect(cr.requestId).toBeTruthy();
    const csk = cr.conferenceSolutionKey as { type: string };
    expect(csk.type).toBe("hangoutsMeet");
  });

  it("attendees があれば displayName 付きで詰める", () => {
    const body = buildCreateEventBody({
      ...baseInput,
      attendees: [{ email: "a@example.com", name: "A 様" }],
    });
    const attendees = body.attendees as Array<{ email: string; displayName?: string }>;
    expect(attendees).toHaveLength(1);
    expect(attendees[0].email).toBe("a@example.com");
    expect(attendees[0].displayName).toBe("A 様");
  });

  it("timezone 上書き", () => {
    const body = buildCreateEventBody({ ...baseInput, timezone: "America/Los_Angeles" });
    const start = body.start as { timeZone: string };
    expect(start.timeZone).toBe("America/Los_Angeles");
  });

  it("guestsCanInviteOthers / guestsCanSeeOtherGuests は false(セキュリティ既定)", () => {
    const body = buildCreateEventBody(baseInput);
    expect(body.guestsCanInviteOthers).toBe(false);
    expect(body.guestsCanSeeOtherGuests).toBe(false);
  });

  it("requestId は startsAt と summary 先頭から組成され、衝突しにくい", () => {
    const a = buildCreateEventBody({ ...baseInput, summary: "面談 A" });
    const b = buildCreateEventBody({ ...baseInput, summary: "面談 B" });
    const ra = (
      (a.conferenceData as Record<string, unknown>).createRequest as Record<string, unknown>
    ).requestId;
    const rb = (
      (b.conferenceData as Record<string, unknown>).createRequest as Record<string, unknown>
    ).requestId;
    expect(ra).not.toBe(rb);
  });
});

describe("hasCalendarEventsScope", () => {
  it("calendar.events を含めば true", () => {
    expect(
      hasCalendarEventsScope(
        "openid email https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.events",
      ),
    ).toBe(true);
  });

  it("含まなければ false(既存接続済の Drive only ユーザを再認可に誘導)", () => {
    expect(
      hasCalendarEventsScope("openid email https://www.googleapis.com/auth/drive.readonly"),
    ).toBe(false);
  });

  it("null / undefined / 空文字は false", () => {
    expect(hasCalendarEventsScope(null)).toBe(false);
    expect(hasCalendarEventsScope(undefined)).toBe(false);
    expect(hasCalendarEventsScope("")).toBe(false);
  });
});

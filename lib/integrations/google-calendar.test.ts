import { describe, expect, it } from "vitest";

import { toCalendarEvent } from "./google-calendar";

describe("toCalendarEvent", () => {
  it("時刻付きの確定イベントを CalendarEvent 形に変換", () => {
    const result = toCalendarEvent({
      id: "abc",
      status: "confirmed",
      htmlLink: "https://x",
      summary: "面談",
      start: { dateTime: "2026-07-01T10:00:00+09:00", timeZone: "Asia/Tokyo" },
      end: { dateTime: "2026-07-01T10:45:00+09:00", timeZone: "Asia/Tokyo" },
      organizer: { displayName: "山田" },
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("external_google:abc");
    expect(result!.title).toBe("面談");
    expect(result!.dateKey).toBe("2026-07-01");
    expect(result!.organizerName).toBe("山田");
  });

  it("status=cancelled は null を返す(表示から除外)", () => {
    const result = toCalendarEvent({
      id: "abc",
      status: "cancelled",
      htmlLink: "https://x",
      start: { dateTime: "2026-07-01T10:00:00+09:00" },
      end: { dateTime: "2026-07-01T10:45:00+09:00" },
    });
    expect(result).toBeNull();
  });

  it("終日イベント(date のみ)を JST 0:00 ベースで扱う", () => {
    const result = toCalendarEvent({
      id: "ad",
      status: "confirmed",
      htmlLink: "https://x",
      summary: "祝日",
      start: { date: "2026-07-15" },
      end: { date: "2026-07-15" },
    });
    expect(result).not.toBeNull();
    expect(result!.dateKey).toBe("2026-07-15");
    expect(result!.startsAt.startsWith("2026-07-15")).toBe(true);
  });

  it("summary が無いイベントは '(タイトル無し)' にフォールバック", () => {
    const result = toCalendarEvent({
      id: "ad",
      status: "confirmed",
      htmlLink: "https://x",
      start: { dateTime: "2026-07-01T10:00:00+09:00" },
      end: { dateTime: "2026-07-01T10:45:00+09:00" },
    });
    expect(result!.title).toBe("(タイトル無し)");
  });

  it("hangoutLink があれば joinUrl に採用", () => {
    const result = toCalendarEvent({
      id: "ad",
      status: "confirmed",
      htmlLink: "https://x",
      summary: "Meet 付き",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      start: { dateTime: "2026-07-01T10:00:00+09:00" },
      end: { dateTime: "2026-07-01T10:45:00+09:00" },
    });
    expect(result!.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("hangoutLink 無しで conferenceData.entryPoints に video があれば joinUrl 採用", () => {
    const result = toCalendarEvent({
      id: "ad",
      status: "confirmed",
      htmlLink: "https://x",
      summary: "Meet 付き",
      start: { dateTime: "2026-07-01T10:00:00+09:00" },
      end: { dateTime: "2026-07-01T10:45:00+09:00" },
      conferenceData: {
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+81-3-0000-0000" },
          { entryPointType: "video", uri: "https://meet.google.com/xyz" },
        ],
      },
    });
    expect(result!.joinUrl).toBe("https://meet.google.com/xyz");
  });
});

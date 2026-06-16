import { describe, expect, it } from "vitest";

import { buildIcsEvent, escapeIcsText, foldLine, formatIcsUtc } from "./ics";

describe("escapeIcsText", () => {
  it("\\ ; , 改行をエスケープ", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("単純文字列はそのまま", () => {
    expect(escapeIcsText("hello world")).toBe("hello world");
  });

  it("マルチバイトはそのまま通す", () => {
    expect(escapeIcsText("初回面談")).toBe("初回面談");
  });
});

describe("formatIcsUtc", () => {
  it("ISO 文字列を YYYYMMDDTHHMMSSZ に変換", () => {
    expect(formatIcsUtc("2026-07-01T10:00:00Z")).toBe("20260701T100000Z");
  });

  it("JST 表記でも UTC に丸めて出力", () => {
    expect(formatIcsUtc("2026-07-01T10:00:00+09:00")).toBe("20260701T010000Z");
  });
});

describe("foldLine", () => {
  it("75 オクテット以内は折らない", () => {
    const line = "a".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("76 オクテット以上は CRLF + space で折る", () => {
    const line = "a".repeat(100);
    const folded = foldLine(line);
    expect(folded).toContain("\r\n ");
    // unfold すると元に戻ること
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("マルチバイト文字も byte 長で正しく折る", () => {
    // 日本語 1 文字は UTF-8 で 3 バイト。30 文字で 90 バイト → 折られる
    const line = "あ".repeat(30);
    const folded = foldLine(line);
    expect(folded).toContain("\r\n ");
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("buildIcsEvent", () => {
  const base = {
    uid: "abcd-1234@maira.pro",
    summary: "面談",
    startsAt: "2026-07-01T10:00:00Z",
    endsAt: "2026-07-01T10:45:00Z",
    stamp: "2026-06-25T00:00:00Z",
  };

  it("最小フィールドで VCALENDAR を組み立てる", () => {
    const ics = buildIcsEvent(base);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("UID:abcd-1234@maira.pro");
    expect(ics).toContain("DTSTART:20260701T100000Z");
    expect(ics).toContain("DTEND:20260701T104500Z");
    expect(ics).toContain("DTSTAMP:20260625T000000Z");
    expect(ics).toContain("SUMMARY:面談");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("改行は CRLF + 最後も CRLF で終わる", () => {
    const ics = buildIcsEvent(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").length).toBeGreaterThan(5);
  });

  it("method=CANCEL なら STATUS=CANCELLED + METHOD=CANCEL", () => {
    const ics = buildIcsEvent({ ...base, method: "CANCEL", sequence: 2 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
  });

  it("DESCRIPTION の特殊文字はエスケープされる", () => {
    const ics = buildIcsEvent({ ...base, description: "Zoom; URL を確認\n本文" });
    expect(ics).toContain("DESCRIPTION:Zoom\\; URL を確認\\n本文");
  });

  it("ATTENDEE 行が複数並ぶ", () => {
    const ics = buildIcsEvent({
      ...base,
      attendees: [{ email: "a@example.com", name: "A 様" }, { email: "b@example.com" }],
    });
    // 折り返し(CRLF + 半角スペース)を unfold してから比較する
    const unfolded = ics.replace(/\r\n /g, "");
    const attendeeLines = unfolded.split("\r\n").filter((l) => l.startsWith("ATTENDEE"));
    expect(attendeeLines).toHaveLength(2);
    expect(attendeeLines[0]).toContain("mailto:a@example.com");
    expect(attendeeLines[0]).toContain("CN=A 様");
    expect(attendeeLines[1]).toContain("mailto:b@example.com");
  });

  it("ORGANIZER が指定なしなら ORGANIZER 行は出ない", () => {
    const ics = buildIcsEvent(base);
    expect(ics).not.toContain("ORGANIZER");
  });
});

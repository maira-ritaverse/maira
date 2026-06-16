import { describe, expect, it } from "vitest";

import { buildIcsFeed, defaultFeedRange, extractVevent } from "./feed";

describe("defaultFeedRange", () => {
  it("from は 7 日前、to は 60 日後を返す", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const r = defaultFeedRange(now);
    expect(r.fromIso).toBe("2026-06-24T00:00:00.000Z");
    expect(r.toIso).toBe("2026-08-30T00:00:00.000Z");
  });
});

describe("extractVevent", () => {
  it("VCALENDAR ラップから VEVENT 部だけ取り出す", () => {
    const ics =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const r = extractVevent(ics);
    expect(r).toBe("BEGIN:VEVENT\r\nUID:abc\r\nEND:VEVENT");
  });

  it("VEVENT を含まなければ空文字", () => {
    expect(extractVevent("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")).toBe("");
  });
});

describe("buildIcsFeed", () => {
  const now = new Date("2026-06-25T00:00:00Z");

  it("空ソースなら BEGIN/END だけの空 VCALENDAR を返す", () => {
    const ics = buildIcsFeed({ meetings: [], tasks: [] }, now);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("X-WR-CALNAME:Maira");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("meeting と task の両方を VEVENT として並べる", () => {
    const ics = buildIcsFeed(
      {
        meetings: [
          {
            id: "m1",
            title: "面談",
            starts_at: "2026-07-01T10:00:00Z",
            ends_at: "2026-07-01T10:45:00Z",
            join_url: "https://zoom.us/j/1",
            passcode: "pw",
            provider: "zoom",
          },
        ],
        tasks: [{ id: "t1", title: "電話する", due_at: "2026-07-02T09:00:00Z" }],
      },
      now,
    );
    expect(ics).toContain("UID:meeting:m1@maira.pro");
    expect(ics).toContain("UID:task:t1@maira.pro");
    expect(ics).toContain("SUMMARY:面談");
    expect(ics).toContain("SUMMARY:[タスク] 電話する");
    // passcode は description に含まれる
    expect(ics).toContain("\\nパスコード: pw");
  });

  it("METHOD は PUBLISH(購読フィードは即座に PUSH しないため)", () => {
    const ics = buildIcsFeed({ meetings: [], tasks: [] }, now);
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("ヘッダに X-WR-CALNAME:Maira を含み、Google で「Maira」名で表示される", () => {
    const ics = buildIcsFeed({ meetings: [], tasks: [] }, now);
    expect(ics).toContain("X-WR-CALNAME:Maira");
  });
});

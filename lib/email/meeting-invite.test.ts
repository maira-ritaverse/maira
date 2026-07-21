import { describe, expect, it } from "vitest";

import { _internal } from "./meeting-invite";

const baseArgs = {
  toEmail: "seeker@example.com",
  toName: "山田 太郎",
  organizationName: "Myaira エージェント",
  advisorName: "鈴木 一郎",
  title: "○○求人について",
  startsAt: new Date("2026-07-01T01:00:00Z"),
  endsAt: new Date("2026-07-01T01:45:00Z"),
  joinUrl: "https://zoom.us/j/123456789",
  passcode: "abc123",
  icsContent: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
};

describe("subjectFor", () => {
  it("invite は通常の件名", () => {
    expect(_internal.subjectFor("invite", "面談")).toBe("面談予定のご案内:面談");
  });

  it("reminder_24h は前置きが入る", () => {
    expect(_internal.subjectFor("reminder_24h", "面談")).toBe("【明日】面談 のご予定");
  });

  it("reminder_1h は時間警告", () => {
    expect(_internal.subjectFor("reminder_1h", "面談")).toBe("【まもなく】面談 (1時間後)");
  });

  it("cancel は CANCELLED 識別", () => {
    expect(_internal.subjectFor("cancel", "面談")).toBe("【キャンセル】面談 の予定");
  });
});

describe("buildBody", () => {
  it("通常の招待本文には開催情報・URL・パスコードが入る", () => {
    const body = _internal.buildBody({ ...baseArgs, variant: "invite" });
    expect(body).toContain("山田 太郎 様");
    expect(body).toContain("Myaira エージェント");
    expect(body).toContain("鈴木 一郎");
    expect(body).toContain("○○求人について");
    expect(body).toContain("https://zoom.us/j/123456789");
    expect(body).toContain("abc123");
  });

  it("リマインダーは「リマインダー」と明記する", () => {
    const body = _internal.buildBody({ ...baseArgs, variant: "reminder_24h" });
    expect(body).toContain("リマインダー");
  });

  it("キャンセルは案内文を変える + .ics 添付説明を削除", () => {
    const body = _internal.buildBody({ ...baseArgs, variant: "cancel" });
    expect(body).toContain("キャンセル");
    expect(body).not.toContain(".ics ファイルから");
  });

  it("toName 未指定なら『ご担当者様』にフォールバック", () => {
    const { toName, ...rest } = baseArgs;
    void toName;
    const body = _internal.buildBody({ ...rest, variant: "invite" });
    expect(body).toContain("ご担当者様");
  });

  it("passcode 未指定なら本文にパスコード行が出ない", () => {
    const body = _internal.buildBody({ ...baseArgs, passcode: null, variant: "invite" });
    expect(body).not.toContain("パスコード");
  });
});

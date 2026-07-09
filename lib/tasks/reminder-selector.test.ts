import { describe, expect, it } from "vitest";

import { buildReminderText, selectDueTasks, type TaskCandidate } from "./reminder-selector";

const t = (overrides: Partial<TaskCandidate>): TaskCandidate => ({
  id: "t1",
  dueAt: "2026-08-01T10:00:00Z",
  status: "pending",
  remindedAt: null,
  ...overrides,
});

describe("selectDueTasks", () => {
  const window = {
    start: new Date("2026-08-01T00:00:00Z"),
    end: new Date("2026-08-01T23:59:59Z"),
  };

  it("window 内 の pending / 未 送信 は 選ばれる", () => {
    const result = selectDueTasks([t({ dueAt: "2026-08-01T10:00:00Z" })], window);
    expect(result).toHaveLength(1);
  });

  it("window 外 は 選ばれない", () => {
    const result = selectDueTasks([t({ dueAt: "2026-08-02T00:00:01Z" })], window);
    expect(result).toHaveLength(0);
  });

  it("completed は 除外", () => {
    const result = selectDueTasks([t({ status: "done" })], window);
    expect(result).toHaveLength(0);
  });

  it("既に リマインド 済 は 除外", () => {
    const result = selectDueTasks([t({ remindedAt: "2026-07-31T00:00:00Z" })], window);
    expect(result).toHaveLength(0);
  });

  it("不正 ISO は 除外 (安全 側)", () => {
    const result = selectDueTasks([t({ dueAt: "not-a-date" })], window);
    expect(result).toHaveLength(0);
  });

  it("複数 混在: pending + 未 送信 + window 内 のみ 通す", () => {
    const cands: TaskCandidate[] = [
      { id: "a", dueAt: "2026-08-01T09:00:00Z", status: "pending", remindedAt: null }, // OK
      { id: "b", dueAt: "2026-08-01T09:00:00Z", status: "pending", remindedAt: "past" }, // 既送信
      { id: "c", dueAt: "2026-08-01T09:00:00Z", status: "done", remindedAt: null }, // done
      { id: "d", dueAt: "2026-08-05T09:00:00Z", status: "pending", remindedAt: null }, // window 外
      { id: "e", dueAt: "2026-08-01T00:00:00Z", status: "pending", remindedAt: null }, // 境界
    ];
    const result = selectDueTasks(cands, window);
    expect(result.map((r) => r.id).sort()).toEqual(["a", "e"]);
  });
});

describe("buildReminderText", () => {
  it("タイトル + 期限 の JST 表示 を 含む", () => {
    const text = buildReminderText("履歴書 提出", "2026-08-01T09:00:00Z");
    expect(text).toContain("履歴書 提出");
    expect(text).toContain("期限 リマインド");
    // JST = UTC+9 → 18:00
    expect(text).toContain("18:00");
  });
});

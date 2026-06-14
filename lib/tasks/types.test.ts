import { describe, it, expect } from "vitest";
import {
  createTaskRequestSchema,
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  updateTaskRequestSchema,
  type TaskPriority,
  type TaskStatus,
} from "./types";

/**
 * 求職者側タスクの定数と zod スキーマのテスト。
 *
 * agency_tasks(エージェント業務)とは別物。
 * encrypted_title/description で保存される暗号化対象なので、API 境界の検証が
 * 不十分だと巨大ペイロードが暗号化される事故が起きうる(本テストは現状の
 * 入力制限の有無を明示する目的を兼ねる)。
 */

describe("taskStatuses / taskStatusLabels", () => {
  it("taskStatuses の各値に label がある", () => {
    for (const s of taskStatuses) {
      expect(taskStatusLabels[s]).toBeTruthy();
    }
  });

  it("Record のキーと union が一致", () => {
    expect(Object.keys(taskStatusLabels).sort()).toEqual([...taskStatuses].sort());
  });

  it("4 種(pending / done / skipped / overdue)を網羅", () => {
    expect(taskStatuses).toEqual(["pending", "done", "skipped", "overdue"]);
  });
});

describe("taskPriorities / taskPriorityLabels", () => {
  it("priorities は [0, 1, 2](低・中・高)", () => {
    expect(taskPriorities).toEqual([0, 1, 2]);
  });

  it("各 priority に label がある", () => {
    for (const p of taskPriorities) {
      expect(taskPriorityLabels[p]).toBeTruthy();
    }
  });

  it("0=低 / 1=中 / 2=高(数値が大きいほど優先度が高い契約)", () => {
    expect(taskPriorityLabels[0]).toBe("低");
    expect(taskPriorityLabels[1]).toBe("中");
    expect(taskPriorityLabels[2]).toBe("高");
  });
});

describe("createTaskRequestSchema", () => {
  it("最小構成(title のみ)で通る、priority は default 0", () => {
    const r = createTaskRequestSchema.safeParse({ title: "領収書を送る" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.priority).toBe(0);
  });

  it("title が空文字なら失敗(エラーメッセージは「タイトルは必須です」)", () => {
    const r = createTaskRequestSchema.safeParse({ title: "" });
    expect(r.success).toBe(false);
  });

  it("application_id は省略 / null / UUID を許容", () => {
    expect(createTaskRequestSchema.safeParse({ title: "x" }).success).toBe(true);
    expect(createTaskRequestSchema.safeParse({ title: "x", application_id: null }).success).toBe(
      true,
    );
    expect(
      createTaskRequestSchema.safeParse({
        title: "x",
        application_id: "12345678-1234-1234-1234-123456789012",
      }).success,
    ).toBe(true);
    expect(
      createTaskRequestSchema.safeParse({ title: "x", application_id: "not-uuid" }).success,
    ).toBe(false);
  });

  it("priority は 0/1/2 のみ、整数でない/範囲外は拒否", () => {
    for (const p of [0, 1, 2] as TaskPriority[]) {
      expect(createTaskRequestSchema.safeParse({ title: "x", priority: p }).success).toBe(true);
    }
    expect(createTaskRequestSchema.safeParse({ title: "x", priority: 3 }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ title: "x", priority: -1 }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ title: "x", priority: 1.5 }).success).toBe(false);
  });

  it("description / due_at は省略 / 文字列 / null を許容", () => {
    expect(createTaskRequestSchema.safeParse({ title: "x", description: "詳細" }).success).toBe(
      true,
    );
    expect(createTaskRequestSchema.safeParse({ title: "x", due_at: null }).success).toBe(true);
    expect(
      createTaskRequestSchema.safeParse({ title: "x", due_at: "2026-06-14T12:00:00Z" }).success,
    ).toBe(true);
  });
});

describe("updateTaskRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(true);
  });

  it("title 与えるなら空文字不可", () => {
    expect(updateTaskRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ title: "y" }).success).toBe(true);
  });

  it("status は taskStatuses 以外を拒否", () => {
    for (const s of taskStatuses as readonly TaskStatus[]) {
      expect(updateTaskRequestSchema.safeParse({ status: s }).success).toBe(true);
    }
    expect(updateTaskRequestSchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ status: "DONE" }).success).toBe(false); // 大文字違い
  });

  it("priority も 0/1/2 のみ", () => {
    expect(updateTaskRequestSchema.safeParse({ priority: 2 }).success).toBe(true);
    expect(updateTaskRequestSchema.safeParse({ priority: 3 }).success).toBe(false);
  });

  it("description は null を許容(クリア用)", () => {
    expect(updateTaskRequestSchema.safeParse({ description: null }).success).toBe(true);
  });
});

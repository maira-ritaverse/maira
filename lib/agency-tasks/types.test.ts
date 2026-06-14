import { describe, it, expect } from "vitest";
import {
  agencyTaskPriorityConfig,
  agencyTaskStatusConfig,
  createAgencyTaskRequestSchema,
  getAgencyTaskPriorityConfig,
  getAgencyTaskStatusConfig,
  updateAgencyTaskRequestSchema,
  type AgencyTaskPriority,
  type AgencyTaskStatus,
} from "./types";

/**
 * エージェントタスクのラベル定義と zod スキーマのテスト。
 *
 * status / priority の config は DB の check 制約と画面表示の単一情報源。
 * UI コンポーネントから「未定義の priority に出くわすと落ちる」事故を防ぐため、
 * 構造そのものと、想定外入力でのフォールバック挙動を検証する。
 *
 * zod スキーマは API 境界の検証なので、必須項目 / 文字数上限 / null/未指定の
 * 許容パターンを境界値で固める。
 */

const VALID_UUID = "12345678-1234-1234-1234-123456789012";
const ALL_STATUSES: AgencyTaskStatus[] = ["pending", "completed"];
const ALL_PRIORITIES: AgencyTaskPriority[] = ["high", "normal", "low"];

describe("agencyTaskStatusConfig", () => {
  it("全 AgencyTaskStatus に config がある", () => {
    for (const s of ALL_STATUSES) {
      expect(agencyTaskStatusConfig.find((c) => c.value === s)).toBeDefined();
    }
  });

  it("config 数が union と一致", () => {
    expect(agencyTaskStatusConfig).toHaveLength(ALL_STATUSES.length);
  });

  it("label / className は全部非空", () => {
    for (const c of agencyTaskStatusConfig) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.className.length).toBeGreaterThan(0);
    }
  });
});

describe("agencyTaskPriorityConfig", () => {
  it("全 AgencyTaskPriority に config がある", () => {
    for (const p of ALL_PRIORITIES) {
      expect(agencyTaskPriorityConfig.find((c) => c.value === p)).toBeDefined();
    }
  });

  it("config 数が union と一致", () => {
    expect(agencyTaskPriorityConfig).toHaveLength(ALL_PRIORITIES.length);
  });

  it("order は 1〜3 で連番(優先度の並びを担保)", () => {
    const orders = agencyTaskPriorityConfig.map((c) => c.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3]);
  });

  it("high の order が一番小さい(=画面で最上位に並ぶ)", () => {
    const high = agencyTaskPriorityConfig.find((c) => c.value === "high")!;
    const others = agencyTaskPriorityConfig.filter((c) => c.value !== "high");
    for (const o of others) {
      expect(high.order).toBeLessThan(o.order);
    }
  });

  it("label / className は全部非空", () => {
    for (const c of agencyTaskPriorityConfig) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.className.length).toBeGreaterThan(0);
    }
  });
});

describe("getAgencyTaskStatusConfig", () => {
  it("有効な status の config を返す", () => {
    expect(getAgencyTaskStatusConfig("pending").label).toBe("未完了");
    expect(getAgencyTaskStatusConfig("completed").label).toBe("完了");
  });

  it("想定外は先頭(pending)にフォールバック(落ちない契約)", () => {
    const r = getAgencyTaskStatusConfig("unknown" as AgencyTaskStatus);
    expect(r.value).toBe("pending");
  });
});

describe("getAgencyTaskPriorityConfig", () => {
  it("有効な priority の config を返す", () => {
    expect(getAgencyTaskPriorityConfig("high").label).toBe("高");
    expect(getAgencyTaskPriorityConfig("normal").label).toBe("中");
    expect(getAgencyTaskPriorityConfig("low").label).toBe("低");
  });

  it("想定外は normal(中)にフォールバック(中庸を選ぶ設計)", () => {
    // status のフォールバックは「先頭=pending」、priority は中央値=normal を返す。
    // 画面上、赤バッジが想定外で混ざるよりは灰色の方が事故が少ない。
    const r = getAgencyTaskPriorityConfig("unknown" as AgencyTaskPriority);
    expect(r.value).toBe("normal");
  });
});

describe("createAgencyTaskRequestSchema", () => {
  const base = {
    client_record_id: VALID_UUID,
    assigned_member_id: VALID_UUID,
    title: "リマインドを送る",
  };

  it("最小構成(client + assignee + title)で通る", () => {
    expect(createAgencyTaskRequestSchema.safeParse(base).success).toBe(true);
  });

  it("title が空文字なら失敗", () => {
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, title: "" }).success).toBe(false);
  });

  it("title は 200 文字までは OK / 201 文字で失敗", () => {
    expect(
      createAgencyTaskRequestSchema.safeParse({ ...base, title: "a".repeat(200) }).success,
    ).toBe(true);
    expect(
      createAgencyTaskRequestSchema.safeParse({ ...base, title: "a".repeat(201) }).success,
    ).toBe(false);
  });

  it("client_record_id / assigned_member_id は UUID 必須", () => {
    expect(
      createAgencyTaskRequestSchema.safeParse({ ...base, client_record_id: "not-uuid" }).success,
    ).toBe(false);
    expect(
      createAgencyTaskRequestSchema.safeParse({ ...base, assigned_member_id: "not-uuid" }).success,
    ).toBe(false);
  });

  it("referral_id は省略 / null / UUID を許容、他は拒否", () => {
    expect(
      createAgencyTaskRequestSchema.safeParse({ ...base, referral_id: VALID_UUID }).success,
    ).toBe(true);
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, referral_id: null }).success).toBe(
      true,
    );
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, referral_id: "abc" }).success).toBe(
      false,
    );
  });

  it("priority は ALL_PRIORITIES 以外を拒否", () => {
    for (const p of ALL_PRIORITIES) {
      expect(createAgencyTaskRequestSchema.safeParse({ ...base, priority: p }).success).toBe(true);
    }
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, priority: "urgent" }).success).toBe(
      false,
    );
  });

  it("due_at は ISO 8601 文字列のみ許容(unix 数値や YYYY-MM-DD だけは不可)", () => {
    expect(
      createAgencyTaskRequestSchema.safeParse({ ...base, due_at: "2026-06-14T12:00:00.000Z" })
        .success,
    ).toBe(true);
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, due_at: null }).success).toBe(true);
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, due_at: "2026-06-14" }).success).toBe(
      false,
    );
    expect(createAgencyTaskRequestSchema.safeParse({ ...base, due_at: "abc" }).success).toBe(false);
  });
});

describe("updateAgencyTaskRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    expect(updateAgencyTaskRequestSchema.safeParse({}).success).toBe(true);
  });

  it("status は ALL_STATUSES 以外を拒否", () => {
    expect(updateAgencyTaskRequestSchema.safeParse({ status: "pending" }).success).toBe(true);
    expect(updateAgencyTaskRequestSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(updateAgencyTaskRequestSchema.safeParse({ status: "archived" }).success).toBe(false);
  });

  it("priority は null を許容(優先度のクリア)", () => {
    expect(updateAgencyTaskRequestSchema.safeParse({ priority: null }).success).toBe(true);
    expect(updateAgencyTaskRequestSchema.safeParse({ priority: "high" }).success).toBe(true);
    expect(updateAgencyTaskRequestSchema.safeParse({ priority: "urgent" }).success).toBe(false);
  });

  it("due_at は null を許容(期限のクリア)", () => {
    expect(updateAgencyTaskRequestSchema.safeParse({ due_at: null }).success).toBe(true);
    expect(
      updateAgencyTaskRequestSchema.safeParse({ due_at: "2026-06-14T12:00:00Z" }).success,
    ).toBe(true);
  });

  it("title は 1〜200 文字の境界", () => {
    expect(updateAgencyTaskRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(updateAgencyTaskRequestSchema.safeParse({ title: "a" }).success).toBe(true);
    expect(updateAgencyTaskRequestSchema.safeParse({ title: "a".repeat(200) }).success).toBe(true);
    expect(updateAgencyTaskRequestSchema.safeParse({ title: "a".repeat(201) }).success).toBe(false);
  });
});

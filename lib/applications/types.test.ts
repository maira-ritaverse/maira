import { describe, it, expect } from "vitest";
import {
  applicationDetailsSchema,
  applicationStatuses,
  applicationStatusBadgeClasses,
  applicationStatusLabels,
  createApplicationRequestSchema,
  updateApplicationRequestSchema,
  type ApplicationStatus,
} from "./types";

/**
 * 応募管理の定数 + zod スキーマテスト。
 *
 * application_status の DB enum / 画面ラベル / バッジ色クラスの 3 つが
 * 単一情報源で一致している必要がある。1 つでもキーが欠けると、応募一覧で
 * undefined 表示 or 色なしバッジが出る事故になる。
 */

const ALL_STATUSES: ApplicationStatus[] = [
  "considering",
  "applied",
  "document_review",
  "interview",
  "offer",
  "rejected",
  "declined",
  "withdrawn",
];

describe("applicationStatuses / labels / badgeClasses", () => {
  it("8 種(considering 〜 withdrawn)を網羅", () => {
    expect(applicationStatuses).toEqual([
      "considering",
      "applied",
      "document_review",
      "interview",
      "offer",
      "rejected",
      "declined",
      "withdrawn",
    ]);
  });

  it("全 status にラベルが定義されている", () => {
    for (const s of ALL_STATUSES) {
      expect(applicationStatusLabels[s]).toBeTruthy();
    }
  });

  it("全 status にバッジ色クラスが定義されている(色なし防止)", () => {
    for (const s of ALL_STATUSES) {
      expect(applicationStatusBadgeClasses[s].length).toBeGreaterThan(0);
    }
  });

  it("labels / badgeClasses のキー集合が union と一致(余計なキー混入も検知)", () => {
    expect(Object.keys(applicationStatusLabels).sort()).toEqual([...ALL_STATUSES].sort());
    expect(Object.keys(applicationStatusBadgeClasses).sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe("applicationDetailsSchema", () => {
  it("company + position 必須で通る", () => {
    expect(applicationDetailsSchema.safeParse({ company: "A", position: "Engineer" }).success).toBe(
      true,
    );
  });

  it("company / position の空文字は失敗", () => {
    expect(applicationDetailsSchema.safeParse({ company: "", position: "x" }).success).toBe(false);
    expect(applicationDetailsSchema.safeParse({ company: "x", position: "" }).success).toBe(false);
  });

  it("job_url は URL 形式 or 空文字 or 省略", () => {
    expect(
      applicationDetailsSchema.safeParse({
        company: "X",
        position: "Y",
        job_url: "https://example.com/jobs/1",
      }).success,
    ).toBe(true);
    expect(
      applicationDetailsSchema.safeParse({ company: "X", position: "Y", job_url: "" }).success,
    ).toBe(true);
    expect(
      applicationDetailsSchema.safeParse({ company: "X", position: "Y", job_url: "not-url" })
        .success,
    ).toBe(false);
  });

  it("notes / salary_range / location は省略可・空文字可", () => {
    expect(
      applicationDetailsSchema.safeParse({
        company: "X",
        position: "Y",
        notes: "",
        salary_range: "",
        location: "",
      }).success,
    ).toBe(true);
  });
});

describe("createApplicationRequestSchema", () => {
  const base = { details: { company: "X", position: "Y" } };

  it("最小構成で通る、status は default 'considering'", () => {
    const r = createApplicationRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("considering");
  });

  it("status は ALL_STATUSES のみ", () => {
    for (const s of ALL_STATUSES) {
      expect(createApplicationRequestSchema.safeParse({ ...base, status: s }).success).toBe(true);
    }
    expect(createApplicationRequestSchema.safeParse({ ...base, status: "unknown" }).success).toBe(
      false,
    );
  });

  it("applied_at / next_action_at は null / 省略 / 文字列を許容", () => {
    expect(createApplicationRequestSchema.safeParse({ ...base, applied_at: null }).success).toBe(
      true,
    );
    expect(
      createApplicationRequestSchema.safeParse({ ...base, applied_at: "2026-06-14T12:00:00Z" })
        .success,
    ).toBe(true);
  });

  it("details が無いと失敗", () => {
    expect(createApplicationRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateApplicationRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    expect(updateApplicationRequestSchema.safeParse({}).success).toBe(true);
  });

  it("is_archived は boolean のみ", () => {
    expect(updateApplicationRequestSchema.safeParse({ is_archived: true }).success).toBe(true);
    expect(updateApplicationRequestSchema.safeParse({ is_archived: false }).success).toBe(true);
    expect(updateApplicationRequestSchema.safeParse({ is_archived: "yes" }).success).toBe(false);
  });

  it("status 与えるなら enum 検証される", () => {
    expect(updateApplicationRequestSchema.safeParse({ status: "offer" }).success).toBe(true);
    expect(updateApplicationRequestSchema.safeParse({ status: "unknown" }).success).toBe(false);
  });
});

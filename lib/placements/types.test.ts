import { describe, it, expect } from "vitest";
import {
  createPlacementRequestSchema,
  getPaymentStatusConfig,
  getPlacementEventTypeConfig,
  paymentStatusConfig,
  placementEventTypeConfig,
  updatePlacementRequestSchema,
  type PaymentStatus,
  type PlacementEventType,
} from "./types";

/**
 * placements の定数 + zod スキーマテスト。
 *
 * money 系は型と境界が一番事故を引き起こすので、上限 10 億円 / 整数縛り /
 * commission_rate 0〜100% / 日付フォーマット(YYYY-MM-DD)を境界値で固める。
 */

const VALID_UUID = "12345678-1234-1234-1234-123456789012";
const ALL_EVENT_TYPES: PlacementEventType[] = ["placement", "payment", "refund", "additional"];
const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  "pending",
  "partial",
  "paid",
  "refunded",
  "adjusted",
];

describe("placementEventTypeConfig", () => {
  it("全 PlacementEventType に config がある", () => {
    for (const t of ALL_EVENT_TYPES) {
      expect(placementEventTypeConfig.find((c) => c.value === t)).toBeDefined();
    }
  });

  it("数と union が一致 / label・className 非空", () => {
    expect(placementEventTypeConfig).toHaveLength(ALL_EVENT_TYPES.length);
    for (const c of placementEventTypeConfig) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.className.length).toBeGreaterThan(0);
    }
  });

  it("order 1〜4 で連番", () => {
    expect(placementEventTypeConfig.map((c) => c.order).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("getPlacementEventTypeConfig", () => {
  it("有効な type のラベルを返す", () => {
    expect(getPlacementEventTypeConfig("placement").label).toBe("成約");
    expect(getPlacementEventTypeConfig("payment").label).toBe("入金");
  });

  it("想定外は先頭(placement)にフォールバック", () => {
    const r = getPlacementEventTypeConfig("unknown" as PlacementEventType);
    expect(r.value).toBe("placement");
  });
});

describe("paymentStatusConfig", () => {
  it("全 PaymentStatus に config がある(5 種)", () => {
    for (const s of ALL_PAYMENT_STATUSES) {
      expect(paymentStatusConfig.find((c) => c.value === s)).toBeDefined();
    }
    expect(paymentStatusConfig).toHaveLength(5);
  });

  it("order 1〜5 で連番", () => {
    expect(paymentStatusConfig.map((c) => c.order).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("getPaymentStatusConfig", () => {
  it("有効な status のラベル", () => {
    expect(getPaymentStatusConfig("pending").label).toBe("入金待ち");
    expect(getPaymentStatusConfig("paid").label).toBe("入金済");
  });

  it("想定外は先頭(pending)にフォールバック", () => {
    expect(getPaymentStatusConfig("unknown" as PaymentStatus).value).toBe("pending");
  });
});

describe("createPlacementRequestSchema", () => {
  const base = {
    referral_id: VALID_UUID,
    event_type: "placement" as const,
    event_date: "2026-06-14",
  };

  it("最小構成で通る", () => {
    expect(createPlacementRequestSchema.safeParse(base).success).toBe(true);
  });

  it("referral_id は UUID 必須", () => {
    expect(
      createPlacementRequestSchema.safeParse({ ...base, referral_id: "not-uuid" }).success,
    ).toBe(false);
  });

  it("event_type は ALL_EVENT_TYPES のみ", () => {
    expect(createPlacementRequestSchema.safeParse({ ...base, event_type: "unknown" }).success).toBe(
      false,
    );
  });

  it("event_date は YYYY-MM-DD のみ", () => {
    expect(
      createPlacementRequestSchema.safeParse({ ...base, event_date: "2026/06/14" }).success,
    ).toBe(false);
    expect(
      createPlacementRequestSchema.safeParse({ ...base, event_date: "2026-6-14" }).success,
    ).toBe(false);
    expect(
      createPlacementRequestSchema.safeParse({ ...base, event_date: "2026-06-14T00:00:00Z" })
        .success,
    ).toBe(false);
  });

  it("amount は 0〜10 億の整数(円)", () => {
    expect(createPlacementRequestSchema.safeParse({ ...base, amount: 0 }).success).toBe(true);
    expect(createPlacementRequestSchema.safeParse({ ...base, amount: 1_000_000_000 }).success).toBe(
      true,
    );
    expect(createPlacementRequestSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
    expect(createPlacementRequestSchema.safeParse({ ...base, amount: 1_000_000_001 }).success).toBe(
      false,
    );
    expect(createPlacementRequestSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
  });

  it("commission_rate は 0〜100(小数 OK)", () => {
    expect(createPlacementRequestSchema.safeParse({ ...base, commission_rate: 35.5 }).success).toBe(
      true,
    );
    expect(createPlacementRequestSchema.safeParse({ ...base, commission_rate: 100 }).success).toBe(
      true,
    );
    expect(
      createPlacementRequestSchema.safeParse({ ...base, commission_rate: -0.01 }).success,
    ).toBe(false);
    expect(
      createPlacementRequestSchema.safeParse({ ...base, commission_rate: 100.01 }).success,
    ).toBe(false);
  });

  it("payment_status は ALL_PAYMENT_STATUSES のみ / null 許容", () => {
    expect(createPlacementRequestSchema.safeParse({ ...base, payment_status: null }).success).toBe(
      true,
    );
    for (const s of ALL_PAYMENT_STATUSES) {
      expect(createPlacementRequestSchema.safeParse({ ...base, payment_status: s }).success).toBe(
        true,
      );
    }
    expect(
      createPlacementRequestSchema.safeParse({ ...base, payment_status: "unknown" }).success,
    ).toBe(false);
  });

  it("notes / reason は 2000 文字境界 / 空文字 OK", () => {
    expect(createPlacementRequestSchema.safeParse({ ...base, notes: "" }).success).toBe(true);
    expect(
      createPlacementRequestSchema.safeParse({ ...base, notes: "a".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("updatePlacementRequestSchema", () => {
  it("全フィールド省略可(部分更新)", () => {
    expect(updatePlacementRequestSchema.safeParse({}).success).toBe(true);
  });

  it("event_date は与えるなら YYYY-MM-DD", () => {
    expect(updatePlacementRequestSchema.safeParse({ event_date: "2026-06-14" }).success).toBe(true);
    expect(updatePlacementRequestSchema.safeParse({ event_date: "abc" }).success).toBe(false);
  });

  it("commission_rate の境界も維持", () => {
    expect(updatePlacementRequestSchema.safeParse({ commission_rate: 100.01 }).success).toBe(false);
  });
});

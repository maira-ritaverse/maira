/**
 * 成約管理(placements)の型定義
 *
 * 1 つの紹介(referral)に対して、複数のイベント(成約 / 入金 /
 * 返金 / 追加報酬)を時系列で積み上げる構造。
 *
 * ⚠️ ラベル・並び・色はこのファイルに一元集約する
 * (referrals / interactions / agency-tasks と同じ方針)。
 * 将来 DB のマスター化に移行するときは、コード側のシグネチャを変えずに
 * 切り替えられるよう placementEventTypeConfig / paymentStatusConfig
 * だけを参照すること。
 */

import { z } from "zod";

// ============================================
// イベント種別
// ============================================
export type PlacementEventType = "placement" | "payment" | "refund" | "additional";

export const placementEventTypeConfig: {
  value: PlacementEventType;
  label: string;
  order: number;
  className: string;
}[] = [
  {
    value: "placement",
    label: "成約",
    order: 1,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  {
    value: "payment",
    label: "入金",
    order: 2,
    className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
  {
    value: "refund",
    label: "返金",
    order: 3,
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  {
    value: "additional",
    label: "追加報酬",
    order: 4,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
];

export function getPlacementEventTypeConfig(type: PlacementEventType) {
  return placementEventTypeConfig.find((t) => t.value === type) ?? placementEventTypeConfig[0];
}

// ============================================
// 支払いステータス
// ============================================
export type PaymentStatus = "pending" | "partial" | "paid" | "refunded" | "adjusted";

export const paymentStatusConfig: {
  value: PaymentStatus;
  label: string;
  order: number;
  className: string;
}[] = [
  {
    value: "pending",
    label: "入金待ち",
    order: 1,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  {
    value: "partial",
    label: "一部入金",
    order: 2,
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  },
  {
    value: "paid",
    label: "入金済",
    order: 3,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  {
    value: "refunded",
    label: "返金済",
    order: 4,
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  {
    value: "adjusted",
    label: "調整済",
    order: 5,
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
];

export function getPaymentStatusConfig(status: PaymentStatus) {
  return paymentStatusConfig.find((s) => s.value === status) ?? paymentStatusConfig[0];
}

// ============================================
// 行データ型
// ============================================
export type Placement = {
  id: string;
  organizationId: string;
  referralId: string;
  eventType: PlacementEventType;
  amount: number | null;
  // 万円単位(例: 600 = 600万円)
  expectedSalary: number | null;
  // % 表記(例: 35.00 = 35%)
  commissionRate: number | null;
  // YYYY-MM-DD
  eventDate: string;
  paymentStatus: PaymentStatus | null;
  notes: string | null;
  reason: string | null;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

// 一覧表示用に記録者名を付与した型
export type PlacementWithAuthor = Placement & {
  authorName: string | null;
};

// ============================================
// zod スキーマ(check 制約と一致)
// ============================================
const placementEventTypeEnum = z.enum(["placement", "payment", "refund", "additional"]);
const paymentStatusEnum = z.enum(["pending", "partial", "paid", "refunded", "adjusted"]);

// amount / expected_salary は「円」「万円」で意味が違うが、どちらも非負整数。
// 上限はオーバーフロー防止用にざっくり 10 億で押さえる。
const nonNegativeInt = z.number().int().min(0).max(1_000_000_000);

export const createPlacementRequestSchema = z.object({
  referral_id: z.string().uuid(),
  event_type: placementEventTypeEnum,
  amount: nonNegativeInt.nullable().optional(),
  expected_salary: nonNegativeInt.nullable().optional(),
  // % は 0〜100。小数2桁まで許容。
  commission_rate: z.number().min(0).max(100).nullable().optional(),
  // YYYY-MM-DD
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_status: paymentStatusEnum.nullable().optional(),
  notes: z.string().max(2000).nullable().optional().or(z.literal("")),
  reason: z.string().max(2000).nullable().optional().or(z.literal("")),
});

export type CreatePlacementRequest = z.infer<typeof createPlacementRequestSchema>;

export const updatePlacementRequestSchema = z.object({
  event_type: placementEventTypeEnum.optional(),
  amount: nonNegativeInt.nullable().optional(),
  expected_salary: nonNegativeInt.nullable().optional(),
  commission_rate: z.number().min(0).max(100).nullable().optional(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  payment_status: paymentStatusEnum.nullable().optional(),
  notes: z.string().max(2000).nullable().optional().or(z.literal("")),
  reason: z.string().max(2000).nullable().optional().or(z.literal("")),
});

export type UpdatePlacementRequest = z.infer<typeof updatePlacementRequestSchema>;

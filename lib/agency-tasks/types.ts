/**
 * エージェント業務タスク(agency_tasks)の型定義
 *
 * エージェント企業内で「誰がいつまでに何をやるか」を管理するための
 * 平文タスク。期限超過アラート(プロアクティブ伴走の企業側版)の
 * 基盤になる。
 *
 * ⚠️ 求職者側の public.tasks(暗号化、task_status enum)とは別物。
 * ラベル・並びはこのファイルに一元集約する(referrals 型と同じ方針)。
 */

import { z } from "zod";

export type AgencyTaskStatus = "pending" | "completed";

export type AgencyTaskPriority = "high" | "normal" | "low";

export const agencyTaskStatusConfig: {
  value: AgencyTaskStatus;
  label: string;
  className: string;
}[] = [
  {
    value: "pending",
    label: "未完了",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  {
    value: "completed",
    label: "完了",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
];

export const agencyTaskPriorityConfig: {
  value: AgencyTaskPriority;
  label: string;
  order: number;
  className: string;
}[] = [
  {
    value: "high",
    label: "高",
    order: 1,
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  {
    value: "normal",
    label: "中",
    order: 2,
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  {
    value: "low",
    label: "低",
    order: 3,
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
];

export function getAgencyTaskStatusConfig(status: AgencyTaskStatus) {
  return agencyTaskStatusConfig.find((s) => s.value === status) ?? agencyTaskStatusConfig[0];
}

export function getAgencyTaskPriorityConfig(priority: AgencyTaskPriority) {
  return agencyTaskPriorityConfig.find((p) => p.value === priority) ?? agencyTaskPriorityConfig[1];
}

export type AgencyTask = {
  id: string;
  organizationId: string;
  clientRecordId: string;
  referralId: string | null;
  assignedMemberId: string;
  title: string;
  status: AgencyTaskStatus;
  priority: AgencyTaskPriority | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// 一覧表示用に担当者の表示名 + アバター URL を付与した型
export type AgencyTaskWithAssignee = AgencyTask & {
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
};

// check 制約と一致する zod enum
const agencyTaskStatusEnum = z.enum(["pending", "completed"]);
const agencyTaskPriorityEnum = z.enum(["high", "normal", "low"]);

export const createAgencyTaskRequestSchema = z.object({
  client_record_id: z.string().uuid(),
  referral_id: z.string().uuid().nullable().optional(),
  assigned_member_id: z.string().uuid(),
  title: z.string().min(1, "タイトルを入力してください").max(200),
  priority: agencyTaskPriorityEnum.optional(),
  due_at: z.string().datetime().nullable().optional(),
});

export type CreateAgencyTaskRequest = z.infer<typeof createAgencyTaskRequestSchema>;

export const updateAgencyTaskRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: agencyTaskStatusEnum.optional(),
  priority: agencyTaskPriorityEnum.nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  assigned_member_id: z.string().uuid().optional(),
});

export type UpdateAgencyTaskRequest = z.infer<typeof updateAgencyTaskRequestSchema>;

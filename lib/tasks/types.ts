import { z } from "zod";

/**
 * タスク(tasks)の型定義と Zod スキーマ
 *
 * tasks は applications に紐づく(任意)プロアクティブ伴走のためのタスク。
 * encrypted_title / encrypted_description は bytea として保存する。
 */

/**
 * タスクステータス(DB の task_status enum と一致)
 */
export const taskStatuses = ["pending", "done", "skipped", "overdue"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "未完了",
  done: "完了",
  skipped: "スキップ",
  overdue: "期限超過",
};

/**
 * タスクの優先度(0: 低 / 1: 中 / 2: 高)
 */
export const taskPriorities = [0, 1, 2] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskPriorityLabels: Record<TaskPriority, string> = {
  0: "低",
  1: "中",
  2: "高",
};

/**
 * タスクの完全な情報(DB から復号して取得した形)
 */
export type Task = {
  id: string;
  application_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * タスクの新規作成リクエスト
 */
export const createTaskRequestSchema = z.object({
  application_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1, "タイトルは必須です"),
  description: z.string().optional(),
  due_at: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(2).optional().default(0),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/**
 * タスクの更新リクエスト
 */
export const updateTaskRequestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  due_at: z.string().optional().nullable(),
  status: z.enum(taskStatuses).optional(),
  priority: z.number().int().min(0).max(2).optional(),
});

export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

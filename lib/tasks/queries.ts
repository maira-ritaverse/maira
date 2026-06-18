import { createClient } from "@/lib/supabase/server";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import type { CreateTaskRequest, Task, TaskPriority, TaskStatus, UpdateTaskRequest } from "./types";

/**
 * tasks テーブルの CRUD ヘルパー
 *
 * 暗号化(2026-06-18):
 *   ・encrypted_title_v2 / encrypted_description_v2 (text) に AES-256-GCM の
 *     "v{n}:base64url" 暗号文を格納する。
 *   ・旧 encrypted_title / encrypted_description (bytea) は触らない
 *     (マイグレーションで NOT NULL 解除済み)。
 *   ・既存データのバックフィルは scripts/backfill-field-encryption.ts で実施。
 */

/**
 * 特定の応募に紐づくタスク一覧を取得
 *
 * 期限が近い順 → 同じ期限なら優先度が高い順 → 期限なしは最後。
 */
export async function listTasksByApplication(
  applicationId: string,
  userId: string,
): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, application_id, encrypted_title_v2, encrypted_description_v2, due_at, status, priority, reminded_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false });

  if (error) {
    throw new Error(`Failed to list tasks: ${error.message}`);
  }

  const rows = (data ?? []) as TaskRow[];
  return await Promise.all(rows.map(mapTaskRow));
}

/**
 * ユーザーの未完了タスクをすべて取得(横断ビュー用)
 *
 * done 以外を期限が近い順に返す。pending / skipped / overdue を含む。
 */
export async function listAllTasks(userId: string): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, application_id, encrypted_title_v2, encrypted_description_v2, due_at, status, priority, reminded_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .neq("status", "done")
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to list all tasks: ${error.message}`);
  }

  const rows = (data ?? []) as TaskRow[];
  return await Promise.all(rows.map(mapTaskRow));
}

/**
 * タスクを新規作成
 */
export async function createTask(userId: string, input: CreateTaskRequest): Promise<string> {
  const supabase = await createClient();

  const titleCipher = await encryptField(input.title);
  // description は任意。空文字 / undefined は null として保存。
  const descCipher = input.description ? await encryptField(input.description) : null;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      application_id: input.application_id ?? null,
      encrypted_title_v2: titleCipher,
      encrypted_description_v2: descCipher,
      due_at: input.due_at ?? null,
      priority: input.priority ?? 0,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create task: ${error?.message ?? "unknown"}`);
  }

  return data.id as string;
}

/**
 * タスクを更新(部分更新)
 *
 * description に null を明示的に渡せばクリア可能、undefined なら未変更。
 */
export async function updateTask(
  taskId: string,
  userId: string,
  input: UpdateTaskRequest,
): Promise<void> {
  const supabase = await createClient();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.title !== undefined) {
    updates.encrypted_title_v2 = await encryptField(input.title);
  }
  if (input.description !== undefined) {
    updates.encrypted_description_v2 = input.description
      ? await encryptField(input.description)
      : null;
  }
  if (input.due_at !== undefined) updates.due_at = input.due_at;
  if (input.status !== undefined) updates.status = input.status;
  if (input.priority !== undefined) updates.priority = input.priority;

  const { error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update task: ${error.message}`);
  }
}

/**
 * タスクを物理削除
 */
export async function deleteTask(taskId: string, userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("tasks").delete().eq("id", taskId).eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete task: ${error.message}`);
  }
}

// ====================================================================
// 内部ヘルパー
// ====================================================================

type TaskRow = {
  id: string;
  application_id: string | null;
  encrypted_title_v2: string | null;
  encrypted_description_v2: string | null;
  due_at: string | null;
  status: string;
  priority: number;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * decryptField は "v{n}:..." 暗号文も バックフィル前の平文も同じ I/F で返す
 * (プレフィックス無しはそのまま返す仕様)。title は NOT NULL の論理セマンティクス
 * なので、null / undefined のときは空文字でフォールバック。
 */
async function mapTaskRow(row: TaskRow): Promise<Task> {
  const title = (await decryptField(row.encrypted_title_v2)) ?? "";
  const description = row.encrypted_description_v2
    ? ((await decryptField(row.encrypted_description_v2)) ?? null)
    : null;

  return {
    id: row.id,
    application_id: row.application_id,
    title,
    description,
    due_at: row.due_at,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    reminded_at: row.reminded_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

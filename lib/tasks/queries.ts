import { createClient } from "@/lib/supabase/server";
import { byteaToText, textToByteaInput } from "@/lib/crypto/bytea";
import type { CreateTaskRequest, Task, TaskPriority, TaskStatus, UpdateTaskRequest } from "./types";

/**
 * tasks テーブルの CRUD ヘルパー
 *
 * encrypted_title / encrypted_description は bytea として保存する。
 * 暗号化は未実装(Week 3 で本実装)、現状は UTF-8 バイト列を \xHEX 形式で書き込む。
 * encryption_iv は暗号化前のためダミー(空 bytea)を入れる。
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
    .select("*")
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false });

  if (error) {
    throw new Error(`Failed to list tasks: ${error.message}`);
  }

  return (data ?? []).map(mapTaskRow);
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
    .select("*")
    .eq("user_id", userId)
    .neq("status", "done")
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to list all tasks: ${error.message}`);
  }

  return (data ?? []).map(mapTaskRow);
}

/**
 * タスクを新規作成
 */
export async function createTask(userId: string, input: CreateTaskRequest): Promise<string> {
  const supabase = await createClient();

  const titleBytea = textToByteaInput(input.title);
  // description は任意。空文字も「中身なし」として null を入れる。
  const descBytea = input.description ? textToByteaInput(input.description) : null;
  const dummyIv = textToByteaInput("");

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      application_id: input.application_id ?? null,
      encrypted_title: titleBytea,
      encrypted_description: descBytea,
      encryption_iv: dummyIv,
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
    updates.encrypted_title = textToByteaInput(input.title);
  }
  if (input.description !== undefined) {
    updates.encrypted_description = input.description ? textToByteaInput(input.description) : null;
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
  encrypted_title: unknown;
  encrypted_description: unknown;
  due_at: string | null;
  status: string;
  priority: number;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    application_id: row.application_id,
    title: byteaToText(row.encrypted_title),
    description: row.encrypted_description ? byteaToText(row.encrypted_description) : null,
    due_at: row.due_at,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    reminded_at: row.reminded_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

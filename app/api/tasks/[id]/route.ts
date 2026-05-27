import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteTask, updateTask } from "@/lib/tasks/queries";
import { updateTaskRequestSchema } from "@/lib/tasks/types";

/**
 * タスク個別操作 API
 *
 * 所有者確認は queries 内で `.eq("user_id", userId)` を併用して行うため、
 * 他人のタスクへの操作は影響なし(行が見つからず更新 0 件)。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/tasks/[id]
 * タスクを部分更新
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    await updateTask(id, user.id, parsed.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to update",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/tasks/[id]
 * タスクを物理削除
 */
export async function DELETE(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteTask(id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to delete",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}

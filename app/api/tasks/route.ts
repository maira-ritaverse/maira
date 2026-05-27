import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyApplicationOwner } from "@/lib/applications/queries";
import { createTask, listTasksByApplication } from "@/lib/tasks/queries";
import { createTaskRequestSchema } from "@/lib/tasks/types";

/**
 * タスク一覧 / 新規作成 API
 *
 * 所有者確認は紐づく application 経由で行う。
 * application_id が指定されていない場合(横断タスク)は将来用に POST のみ素通し。
 */

/**
 * GET /api/tasks?application_id=xxx
 * 特定の応募に紐づくタスク一覧を取得
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("application_id");

  if (!applicationId) {
    return NextResponse.json({ error: "application_id is required" }, { status: 400 });
  }

  const isOwner = await verifyApplicationOwner(applicationId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const tasks = await listTasksByApplication(applicationId, user.id);
    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/tasks
 * タスクを新規作成。application_id が指定されていればその application の所有者確認も行う。
 */
export async function POST(request: Request) {
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

  const parsed = createTaskRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  if (parsed.data.application_id) {
    const isOwner = await verifyApplicationOwner(parsed.data.application_id, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const id = await createTask(user.id, parsed.data);
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to create",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 },
    );
  }
}

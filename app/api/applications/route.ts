import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  applicationStatuses,
  createApplicationRequestSchema,
  type ApplicationStatus,
} from "@/lib/applications/types";
import { createApplication, listApplications } from "@/lib/applications/queries";

/**
 * 応募一覧 / 新規作成 API
 *
 * 認証チェックは Server Component 側でもしているが、API 直叩きの可能性があるため
 * ここでも必ず getUser() で確認する。
 */

/**
 * GET /api/applications?status=xxx
 * 自分の応募一覧を取得(未アーカイブのみ、updated_at 降順)
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
  const statusParam = searchParams.get("status");

  // 想定外のステータス値は無視して全件返す(エラーにはしない)
  const statusFilter =
    statusParam && (applicationStatuses as readonly string[]).includes(statusParam)
      ? (statusParam as ApplicationStatus)
      : undefined;

  try {
    const applications = await listApplications(user.id, statusFilter);
    return NextResponse.json({ applications });
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
 * POST /api/applications
 * 応募を新規作成。戻り値は作成した id。
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

  const parsed = createApplicationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const id = await createApplication(user.id, parsed.data);
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

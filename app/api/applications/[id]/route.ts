import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateApplicationRequestSchema } from "@/lib/applications/types";
import {
  deleteApplication,
  getApplication,
  updateApplication,
  verifyApplicationOwner,
} from "@/lib/applications/queries";

/**
 * 応募詳細 / 更新 / 削除 API
 *
 * PATCH と DELETE では verifyApplicationOwner を呼んで明示的に所有者確認する。
 * RLS でも弾けるが、誤った id への操作を 403 で早期に返すため。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/applications/[id]
 * 応募 1 件を取得
 */
export async function GET(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const application = await getApplication(id, user.id);
    if (!application) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ application });
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
 * PATCH /api/applications/[id]
 * 応募を部分更新
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

  const isOwner = await verifyApplicationOwner(id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateApplicationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    await updateApplication(id, user.id, parsed.data);
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
 * DELETE /api/applications/[id]
 * 応募を物理削除(関連 tasks も ON DELETE CASCADE で同時に消える)
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

  const isOwner = await verifyApplicationOwner(id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteApplication(id, user.id);
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

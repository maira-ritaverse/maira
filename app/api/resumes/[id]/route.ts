import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteResume, updateResume, verifyResumeOwner } from "@/lib/resumes/queries";
import { saveResumeRequestSchema } from "@/lib/resumes/types";

/**
 * 履歴書 更新 / 削除 API
 *
 * RLS でも弾けるが、誤った id への操作を 403 で早期に返すため
 * verifyResumeOwner で明示的に所有者確認する。
 */

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/resumes/[id]
 * 履歴書を上書き保存(部分更新ではなく、フォームから全項目送る前提)
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

  const isOwner = await verifyResumeOwner(id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = saveResumeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    await updateResume(id, user.id, parsed.data);
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
 * DELETE /api/resumes/[id]
 * 履歴書を物理削除
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

  const isOwner = await verifyResumeOwner(id, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteResume(id, user.id);
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

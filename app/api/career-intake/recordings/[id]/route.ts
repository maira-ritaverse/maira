import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";

/**
 * /api/career-intake/recordings/[id]
 *
 *   GET    - 軽量ステータス取得(UI ポーリング用、復号しない)
 *   PATCH  - タイトル(original_filename)編集
 *   DELETE - 削除(行 + Storage)
 *
 * 本人のみ。RLS でも保護されるが、明示的に user_id でも絞る。
 */

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  originalFilename: z.string().min(1).max(200),
});

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // ポーリング用なので最小列のみ。復号も走らせない。
  const { data, error } = await supabase
    .from("career_intake_recordings")
    .select("id, status, status_message, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = patchSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("career_intake_recordings")
    .update({ original_filename: parsed.data.originalFilename.trim() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // storage パスを取得してから DELETE
  const { data } = await supabase
    .from("career_intake_recordings")
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  const path = (data as { storage_path: string } | null)?.storage_path;

  // 行削除(CASCADE はないが、ファイルは別途消す)
  const { error } = await supabase
    .from("career_intake_recordings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "Failed to delete", message: error.message },
      { status: 500 },
    );
  }

  if (path) {
    // Storage 側の失敗は本処理に影響させない(行は既に消えているのでガベージ扱い)
    const { error: rmErr } = await supabase.storage.from("career-intake-audio").remove([path]);
    if (rmErr) {
      console.warn(`[career-intake] storage remove failed: ${rmErr.message}`);
    }
  }

  return NextResponse.json({ success: true });
}

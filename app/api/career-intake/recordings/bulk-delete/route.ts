import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody, requireUser } from "@/lib/api/auth-guards";

/**
 * POST /api/career-intake/recordings/bulk-delete
 *
 * 録音を一括削除する(DB 行 + Storage オブジェクト)。
 * - 本人のみ(RLS + 明示的 user_id チェック)
 * - 最大 100 件(誤コピペ抑制)
 *
 * 注意:Storage 削除は best-effort(失敗してもログのみ。DB 行は消える)。
 */

const MAX_IDS = 100;

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_IDS),
});

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = requestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.format() },
      { status: 400 },
    );
  }

  // 削除前に Storage パスを取得
  const { data: rows } = await supabase
    .from("career_intake_recordings")
    .select("id, storage_path")
    .in("id", parsed.data.ids)
    .eq("user_id", user.id);
  const paths = ((rows ?? []) as Array<{ storage_path: string }>)
    .map((r) => r.storage_path)
    // 擬似録音(キャリア棚卸し対話由来、"conversation:..." 形式)は Storage に無いので除外
    .filter((p) => !p.startsWith("conversation:"));

  const { error: delErr, data: delData } = await supabase
    .from("career_intake_recordings")
    .delete()
    .in("id", parsed.data.ids)
    .eq("user_id", user.id)
    .select("id");

  if (delErr) {
    return NextResponse.json(
      { error: "Failed to delete", message: delErr.message },
      { status: 500 },
    );
  }

  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from("career-intake-audio").remove(paths);
    if (rmErr) {
      // Storage 失敗は警告のみ
      console.warn(`[career-intake bulk-delete] storage remove failed: ${rmErr.message}`);
    }
  }

  return NextResponse.json({ deleted: (delData ?? []).length });
}

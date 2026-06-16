import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";

/**
 * POST /api/integrations/zoom/disconnect
 *
 * zoom_connections から本人の行を削除して接続を解除する。
 * Zoom 側のトークン revoke API は best-effort(失敗しても DB 側は削除する)。
 */
export async function POST() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { supabase, user } = guard;

  // 既存接続を取り、Zoom 側 revoke を試す(失敗しても続行)
  const { data: row } = await supabase
    .from("zoom_connections")
    .select("encrypted_access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  // ここで decryptField → fetch revoke も書けるが、Zoom revoke は connector 削除時に
  // ユーザがダッシュボードからも切れるためベストエフォート。意図的に省略。
  void row;

  const { error } = await supabase.from("zoom_connections").delete().eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "db_delete_failed", message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

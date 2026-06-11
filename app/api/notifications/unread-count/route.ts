import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/notifications/unread-count
 *
 * ベルのバッジ表示用。未読(read_at is null)件数だけを返す軽量エンドポイント。
 * ポーリング対象がこれだけになるため、本体取得 /api/notifications より高頻度
 * に叩かれる前提で head: true(行データは返さない)を使う。
 *
 * 認可:RLS により他人の行は数えられない。.eq も二重防御で明示。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    return NextResponse.json(
      { error: "Failed to count notifications", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ count: count ?? 0 });
}

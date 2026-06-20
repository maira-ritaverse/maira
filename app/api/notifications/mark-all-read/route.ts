import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/notifications/mark-all-read
 *
 * 自分 (auth.uid()) の 未読通知 を 一括 既読化 (read_at = now())。
 *
 * 認可:RLS の UPDATE ポリシー で 自分 の 行 のみ 更新可能 +
 *      .eq("user_id", user.id) で 二重防御。
 *
 * 冪等性:既に 既読 の 行 は WHERE 句 で 除外 する (read_at IS NULL)
 *        ので 二度 叩いて も 副作用 なし。
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error, count } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() }, { count: "exact" })
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) {
    return NextResponse.json(
      { error: "Failed to mark all as read", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, updatedCount: count ?? 0 });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/notifications/[id]/read
 *
 * 指定通知を既読化する(read_at = now())。
 *
 * 認可:RLS の UPDATE ポリシー(auth.uid() = user_id)で自分の通知のみ更新可能。
 * .eq("user_id", user.id) は二重防御として明示。
 *
 * 冪等性:再既読(既に read_at が入っている行)も成功扱い。UPDATE が 0 行
 * 返すのは「既読済 or 自分の行ではない」のどちらか。後者は RLS で 0 行になるので
 * 区別がつかないが、UI 上はどちらでも「既読にできた = OK」で問題ない。
 */
type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to mark as read", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

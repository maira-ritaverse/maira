import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /r/[id]
 *
 * 短縮 トラッキング URL の リダイレクト 先。
 *   1. ma_click_links を id で 引く
 *   2. click_count を ++ + last_clicked_at を 更新
 *   3. original_url へ 301 redirect
 *
 * 認証 不要 (公開 short URL)。 個人 識別 情報 は 取らない。
 * id が 不正 / 未登録 の 場合 は 404 ではなく ホーム へ silent redirect
 * (受信者 が 古い URL を 踏んだ 時 の UX 確保)。
 */
type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: Params) {
  const { id } = await ctx.params;
  const admin = createServiceClient();

  const { data } = await admin
    .from("ma_click_links")
    .select("id, original_url, click_count")
    .eq("id", id)
    .maybeSingle();
  type Row = { id: string; original_url: string; click_count: number };
  const row = data as Row | null;

  if (!row) {
    // 不正 / 期限切れ → ホーム へ silent redirect
    return NextResponse.redirect(new URL("/", new URL(_.url).origin), 302);
  }

  // クリック 計上 (失敗 して も redirect は 行う)
  void admin
    .from("ma_click_links")
    .update({
      click_count: row.click_count + 1,
      last_clicked_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.redirect(row.original_url, 302);
}

import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { listConversationMessages } from "@/lib/line/conversations";

/**
 * GET /api/agency/line/conversations/[lineUserId]/messages
 *
 * 個別 会話 の メッセージ履歴 を 返す (古い順、 max 200 件)。
 * チャット UI の ポーリング / 送信後 リフレッシュ で 使う。
 */
type RouteContext = { params: Promise<{ lineUserId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { lineUserId: rawLineUserId } = await context.params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  // 自組織 の line_user_id である か 軽く 確認
  const { data: linkRow } = await guard.supabase
    .from("line_user_links")
    .select("line_user_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (!linkRow) {
    return NextResponse.json({ error: "line_user_not_found" }, { status: 404 });
  }

  const messages = await listConversationMessages(guard.supabase, lineUserId, 200);
  return NextResponse.json({ messages });
}

import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { listConversations } from "@/lib/line/conversations";

/**
 * GET /api/agency/line/conversations
 *
 * 会話 一覧 (LINE トーク 一覧 サイドバー 用)。
 * Server Layout が 初期 値 を 渡す が、 ブラウザ 側 で 短い 間隔 で ポーリング
 * する こと で 新着 / 既読 / 並び 順 を リアルタイム 風 に 反映 する。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const conversations = await listConversations(guard.supabase);
  return NextResponse.json({ conversations });
}

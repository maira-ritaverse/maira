import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";

/**
 * GET /api/agency/line/user-links
 *
 * 組織 の LINE 友達 一覧 + client_record 紐付け 状態 を 返す。
 * 未連携 / 連携済 / ブロック済 を 1 リクエスト で 取得。
 *
 * クライアント 側 (友達一覧 UI) で フィルタ する 想定。
 */
type Row = {
  id: string;
  line_user_id: string;
  client_record_id: string | null;
  display_name: string | null;
  picture_url: string | null;
  linked_at: string | null;
  link_method: "manual" | "code" | "liff_login" | "auto_name_match" | null;
  unfollowed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .from("line_user_links")
    .select(
      "id, line_user_id, client_record_id, display_name, picture_url, linked_at, link_method, unfollowed_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  const links = (data ?? []) as Row[];

  // client_record_id 一括 引き (name)
  const clientRecordIds = Array.from(
    new Set(links.map((l) => l.client_record_id).filter((v): v is string => v !== null)),
  );

  const clientNameMap = new Map<string, string>();
  if (clientRecordIds.length > 0) {
    const { data: clientRows } = await guard.supabase
      .from("client_records")
      .select("id, name")
      .in("id", clientRecordIds);
    for (const c of (clientRows ?? []) as Array<{ id: string; name: string }>) {
      clientNameMap.set(c.id, c.name);
    }
  }

  return NextResponse.json({
    links: links.map((l) => ({
      id: l.id,
      lineUserId: l.line_user_id,
      clientRecordId: l.client_record_id,
      clientName: l.client_record_id ? (clientNameMap.get(l.client_record_id) ?? null) : null,
      displayName: l.display_name,
      pictureUrl: l.picture_url,
      linkedAt: l.linked_at,
      linkMethod: l.link_method,
      unfollowedAt: l.unfollowed_at,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    })),
  });
}

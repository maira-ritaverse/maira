import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { getOrCreateThread, listThreads } from "@/lib/advisor/queries";
import { createThreadSchema } from "@/lib/advisor/types";

/**
 * GET  /api/agency/advisor/threads        → 自組織 の thread 一覧 (最新 順)
 * POST /api/agency/advisor/threads        → client_records から thread を 取得 or 作成
 *
 * RLS で 自組織 範囲 だけ 見える / 作れる。
 */
export async function GET() {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const threads = await listThreads(guard.supabase);

  // 相手 (求職者) の 表示 名 を 一括 取得。 client_records は org スコープ で RLS 効く。
  const clientRecordIds = threads.map((t) => t.clientRecordId);
  if (clientRecordIds.length === 0) return NextResponse.json({ threads });

  const { data: clientRows } = await guard.supabase
    .from("client_records")
    .select("id, display_name")
    .in("id", clientRecordIds);
  type ClientRow = { id: string; display_name: string | null };
  const nameMap = new Map(((clientRows ?? []) as ClientRow[]).map((c) => [c.id, c.display_name]));

  return NextResponse.json({
    threads: threads.map((t) => ({
      ...t,
      counterpartDisplayName: nameMap.get(t.clientRecordId) ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = createThreadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // client_records が 同 org か つ linked_user_id が ある か 確認 (RLS が 主だが
  // 422 を 明示 返す ため アプリ 層 でも 検証)
  const { data: clientRow } = await guard.supabase
    .from("client_records")
    .select("id, organization_id, linked_user_id")
    .eq("id", parsed.data.clientRecordId)
    .maybeSingle();
  const client = clientRow as {
    id: string;
    organization_id: string;
    linked_user_id: string | null;
  } | null;
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  if (client.organization_id !== guard.organization.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!client.linked_user_id) {
    return NextResponse.json(
      {
        error: "client_not_linked",
        message:
          "求職者 が マイラ に 連携 されて いない ため、 アプリ 内 メッセージ は 利用 できません。",
      },
      { status: 422 },
    );
  }

  const row = await getOrCreateThread(guard.supabase, {
    organizationId: guard.organization.id,
    clientRecordId: client.id,
    seekerUserId: client.linked_user_id,
  });
  if (!row) {
    return NextResponse.json({ error: "thread_create_failed" }, { status: 500 });
  }
  return NextResponse.json({
    thread: {
      id: row.id,
      organizationId: row.organization_id,
      clientRecordId: row.client_record_id,
      seekerUserId: row.seeker_user_id,
      lastMessageAt: row.last_message_at,
      unreadForSeeker: row.unread_for_seeker,
      unreadForAgency: row.unread_for_agency,
      createdAt: row.created_at,
    },
  });
}

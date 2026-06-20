import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { listMessages, markThreadRead, postMessage } from "@/lib/advisor/queries";
import { postMessageSchema } from "@/lib/advisor/types";
import { fireInAppNotification } from "@/lib/notifications/in-app";

/**
 * GET  /api/app/advisor/threads/[id]/messages
 *   求職者 視点 の メッセージ 一覧 + 既読 マーク。
 *
 * POST /api/app/advisor/threads/[id]/messages
 *   求職者 から の 投稿。 エージェント 全員 に in_app 通知。
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Params) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { id: threadId } = await ctx.params;

  const { data: thread } = await guard.supabase
    .from("advisor_threads")
    .select("id, seeker_user_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const messages = await listMessages(guard.supabase, threadId);
  await markThreadRead(guard.supabase, { threadId, reader: "seeker" });
  return NextResponse.json({ messages });
}

export async function POST(request: Request, ctx: Params) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  const { id: threadId } = await ctx.params;

  const json = (await request.json().catch(() => null)) as unknown;
  const parsed = postMessageSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data: thread } = await guard.supabase
    .from("advisor_threads")
    .select("id, organization_id, client_record_id, seeker_user_id")
    .eq("id", threadId)
    .maybeSingle();
  type ThreadRow = {
    id: string;
    organization_id: string;
    client_record_id: string;
    seeker_user_id: string;
  };
  const t = thread as ThreadRow | null;
  if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // 求職者 本人 の thread か 確認 (RLS で 効く が 明示)
  if (t.seeker_user_id !== guard.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await postMessage(guard.supabase, {
    threadId,
    senderKind: "seeker",
    senderUserId: guard.user.id,
    content: parsed.data.content,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  // 通知: エージェント 全員 (送信者 本人 除外)。 求職者 から の 投稿 なので
  // 送信者 = 求職者 = excludeUserId に 入れて も org メンバー には ヒット しない。
  // 求職者 の 表示 名 を 取得 (client_records.display_name)
  const { data: clientRow } = await guard.supabase
    .from("client_records")
    .select("display_name")
    .eq("id", t.client_record_id)
    .maybeSingle();
  const clientName =
    (clientRow as { display_name: string | null } | null)?.display_name ?? "求職者";

  void fireInAppNotification({
    organizationId: t.organization_id,
    excludeUserId: guard.user.id,
    payload: {
      kind: "advisor_message_to_agency",
      title: `${clientName} さん から 新着 メッセージ`,
      href: buildAbsoluteUrl(`/agency/advisor/${t.id}`),
      threadId: t.id,
      clientRecordId: t.client_record_id,
      clientName,
      preview: parsed.data.content.slice(0, 80),
    },
  });

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    createdAt: result.createdAt,
  });
}

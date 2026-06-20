import { NextResponse } from "next/server";

import { requireOrgMember } from "@/lib/api/auth-guards";
import { buildAbsoluteUrl } from "@/lib/config/site-url";
import { listMessages, markThreadRead, postMessage } from "@/lib/advisor/queries";
import { postMessageSchema } from "@/lib/advisor/types";
import { fireSeekerNotification } from "@/lib/notifications/in-app";

/**
 * GET  /api/agency/advisor/threads/[id]/messages
 *   メッセージ 一覧 (古い → 新しい)。 開いた タイミング で 既読 マーク。
 *
 * POST /api/agency/advisor/threads/[id]/messages
 *   { content } を 暗号化 して 保存 + 求職者 に in_app 通知。
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Params) {
  const guard = await requireOrgMember();
  if (!guard.ok) return guard.response;
  const { id: threadId } = await ctx.params;

  // 自組織 の thread か RLS で 保証 される が、 念のため SELECT で 存在 確認
  const { data: thread } = await guard.supabase
    .from("advisor_threads")
    .select("id, organization_id, client_record_id, seeker_user_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const messages = await listMessages(guard.supabase, threadId);
  await markThreadRead(guard.supabase, { threadId, reader: "agency" });
  return NextResponse.json({ messages });
}

export async function POST(request: Request, ctx: Params) {
  const guard = await requireOrgMember();
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

  // thread 情報 取得 (通知 で seeker_user_id 必要)
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

  const result = await postMessage(guard.supabase, {
    threadId,
    senderKind: "agency",
    senderUserId: guard.user.id,
    content: parsed.data.content,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  // 通知: 求職者 本人 1 名 に in_app 通知
  void fireSeekerNotification({
    userId: t.seeker_user_id,
    payload: {
      kind: "advisor_message_to_seeker",
      title: `${guard.organization.name ?? "エージェント"} から 新着 メッセージ`,
      href: buildAbsoluteUrl(`/app/messages/${t.id}`),
      threadId: t.id,
      organizationName: guard.organization.name ?? "",
      preview: parsed.data.content.slice(0, 80),
    },
  });

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    createdAt: result.createdAt,
  });
}

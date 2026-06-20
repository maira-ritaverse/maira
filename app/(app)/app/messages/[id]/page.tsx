import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdvisorChat } from "@/components/features/advisor/advisor-chat";
import { listMessages, markThreadRead } from "@/lib/advisor/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * /app/messages/[id]
 *
 * 求職者 向け チャット 画面。 SSR で 初期 メッセージ を 復号 して 渡す。
 * 画面 表示時 に 自分側 unread を 0 リセット (既読 マーク)。
 */
export default async function MessageDetailPage({ params }: Params) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // thread 存在 確認 (RLS で 自分 の thread のみ)
  const { data: threadRow } = await supabase
    .from("advisor_threads")
    .select("id, organization_id, seeker_user_id")
    .eq("id", threadId)
    .maybeSingle();
  type Row = { id: string; organization_id: string; seeker_user_id: string };
  const thread = threadRow as Row | null;
  if (!thread) notFound();

  const [{ data: org }, messages] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", thread.organization_id).maybeSingle(),
    listMessages(supabase, threadId),
  ]);
  const orgName = (org as { name: string } | null)?.name ?? "エージェント";

  // 開いた タイミング で 自分側 unread を 0 リセット
  await markThreadRead(supabase, { threadId, reader: "seeker" });

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col gap-3 p-4">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/app/messages" className="hover:underline">
            ← 一覧
          </Link>
        </p>
        <h1 className="mt-1 text-lg font-bold">{orgName}</h1>
      </div>
      <div className="flex-1">
        <AdvisorChat
          threadId={threadId}
          initialMessages={messages}
          currentUserId={user.id}
          mySenderKind="seeker"
          fetchMessagesUrl={`/api/app/advisor/threads/${threadId}/messages`}
          postMessageUrl={`/api/app/advisor/threads/${threadId}/messages`}
        />
      </div>
    </div>
  );
}

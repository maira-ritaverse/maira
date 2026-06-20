import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdvisorChat } from "@/components/features/advisor/advisor-chat";
import { listMessages, markThreadRead } from "@/lib/advisor/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * /agency/advisor/[id]
 *
 * エージェント 視点 の advisor チャット 画面。 SSR で 復号 済 メッセージ を 渡す。
 * 開いた タイミング で エージェント 側 unread を 0 リセット。
 */
export default async function AgencyAdvisorChatPage({ params }: Params) {
  const { id: threadId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const { data: threadRow } = await supabase
    .from("advisor_threads")
    .select("id, organization_id, client_record_id")
    .eq("id", threadId)
    .maybeSingle();
  type Row = { id: string; organization_id: string; client_record_id: string };
  const thread = threadRow as Row | null;
  if (!thread) notFound();

  const [{ data: client }, messages] = await Promise.all([
    supabase
      .from("client_records")
      .select("display_name")
      .eq("id", thread.client_record_id)
      .maybeSingle(),
    listMessages(supabase, threadId),
  ]);
  const clientName = (client as { display_name: string | null } | null)?.display_name ?? "求職者";

  await markThreadRead(supabase, { threadId, reader: "agency" });

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl flex-col gap-3 p-4">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/agency/advisor" className="hover:underline">
            ← 一覧
          </Link>
          {" / "}
          <Link href={`/agency/clients/${thread.client_record_id}`} className="hover:underline">
            求職者 詳細
          </Link>
        </p>
        <h1 className="mt-1 text-lg font-bold">{clientName} さん</h1>
      </div>
      <div className="flex-1">
        <AdvisorChat
          threadId={threadId}
          initialMessages={messages}
          currentUserId={user.id}
          mySenderKind="agency"
          fetchMessagesUrl={`/api/agency/advisor/threads/${threadId}/messages`}
          postMessageUrl={`/api/agency/advisor/threads/${threadId}/messages`}
        />
      </div>
    </div>
  );
}

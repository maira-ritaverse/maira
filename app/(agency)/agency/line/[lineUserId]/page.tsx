import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listConversationMessages, markConversationRead } from "@/lib/line/conversations";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { LineConversationClient } from "./line-conversation-client";

/**
 * /agency/line/[lineUserId]
 *
 * 個別 LINE 会話 ページ (LINE風 バブル UI)。
 *
 * - サーバ側 で メッセージ 履歴 を 復号 し クライアント に 渡す
 * - 「会話 を 開いた」段階 で inbound メッセージ を 既読化
 * - 送信 / ポーリング は クライアント Component (LineConversationClient)
 */
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ lineUserId: string }>;
};

export default async function AgencyLineConversationPage({ params }: RouteContext) {
  const { lineUserId: rawLineUserId } = await params;
  const lineUserId = decodeURIComponent(rawLineUserId);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization) {
    redirect("/app");
  }

  const channel = await getMyLineChannel(supabase);
  if (!channel) redirect("/agency/settings/integrations/line");

  // line_user_links を 引いて 友達 情報 を 取得
  const { data: linkRow } = await supabase
    .from("line_user_links")
    .select("line_user_id, client_record_id, display_name, picture_url, unfollowed_at, link_method")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const link = linkRow as {
    line_user_id: string;
    client_record_id: string | null;
    display_name: string | null;
    picture_url: string | null;
    unfollowed_at: string | null;
    link_method: string | null;
  } | null;

  if (!link) notFound();

  // client_record 名 (任意)
  let clientName: string | null = null;
  if (link.client_record_id) {
    const { data: clientRow } = await supabase
      .from("client_records")
      .select("name")
      .eq("id", link.client_record_id)
      .maybeSingle();
    clientName = (clientRow as { name?: string } | null)?.name ?? null;
  }

  // メッセージ 履歴 取得 (古い順)
  const messages = await listConversationMessages(supabase, lineUserId, 200);

  // 求人共有 用 の 自組織 active 求人 一覧 (UI セレクタ で 使う)
  const { data: jobsData } = await supabase
    .from("job_postings")
    .select("id, position, company_name")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);
  const jobOptions = (
    (jobsData ?? []) as Array<{
      id: string;
      position: string;
      company_name: string;
    }>
  ).map((j) => ({
    id: j.id,
    label: `${j.position} (${j.company_name})`,
  }));

  // 確定済 面談 (キャンセル / リスケ 用) - client_record 経由
  let scheduledMeetings: Array<{
    id: string;
    title: string;
    startsAt: string;
    joinUrl: string;
  }> = [];
  if (link.client_record_id) {
    const { data: meetingsData } = await supabase
      .from("meeting_schedules")
      .select("id, title, starts_at, join_url")
      .eq("client_record_id", link.client_record_id)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(5);
    scheduledMeetings = (
      (meetingsData ?? []) as Array<{
        id: string;
        title: string;
        starts_at: string;
        join_url: string;
      }>
    ).map((m) => ({
      id: m.id,
      title: m.title,
      startsAt: m.starts_at,
      joinUrl: m.join_url,
    }));
  }

  // 既読化 (service_role)
  try {
    const admin = createServiceClient();
    await markConversationRead(admin, role.organization.id, lineUserId);
  } catch {
    // 既読化 失敗 は 致命的でない
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-180px)] max-w-3xl flex-col gap-2">
      {/* ヘッダー (相手 情報) */}
      <Card className="flex items-center gap-3 px-4 py-2">
        <Link
          href="/agency/line"
          className="text-muted-foreground hover:text-foreground text-xs"
          aria-label="一覧に戻る"
        >
          ←
        </Link>
        {link.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={link.picture_url}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full bg-slate-200 object-cover"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-full bg-slate-200" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{link.display_name ?? "(名前なし)"}</p>
          <p className="text-muted-foreground truncate text-[10px]">
            {clientName ? `紐付け: ${clientName}` : "未紐付け"}
            {link.unfollowed_at && " · 解除済"}
          </p>
        </div>
      </Card>

      <LineConversationClient
        lineUserId={lineUserId}
        initialMessages={messages}
        unfollowed={link.unfollowed_at !== null}
        jobOptions={jobOptions}
        scheduledMeetings={scheduledMeetings}
      />
    </div>
  );
}

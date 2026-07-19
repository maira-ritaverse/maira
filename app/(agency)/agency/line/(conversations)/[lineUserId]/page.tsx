import { notFound, redirect } from "next/navigation";

import { getOrgMemberAvatarMaps } from "@/lib/agency/member-avatars";
import { markChatAsRead } from "@/lib/line/api";
import { listConversationMessages, markConversationRead } from "@/lib/line/conversations";
import { getLineChannelByOrgId, getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { ContactDetailSidebar } from "./contact-detail-sidebar";
import { LineConversationClient } from "./line-conversation-client";
import { SidebarRefresh } from "./sidebar-refresh";

/**
 * /agency/line/[lineUserId]
 *
 * 個別 LINE 会話 ページ。 layout で 3 カラム の 左 (会話一覧) が 描画 され、
 * ここ は **中央 (チャット) + 右 (連絡先 詳細)** を 出力 する。
 *
 * - サーバ側 で メッセージ 履歴 を 復号 し クライアント に 渡す
 * - 「会話 を 開いた」段階 で inbound メッセージ を 既読化
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
    .select(
      "line_user_id, client_record_id, display_name, custom_name, picture_url, unfollowed_at, link_method, created_at, assigned_to_user_id",
    )
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const link = linkRow as {
    line_user_id: string;
    client_record_id: string | null;
    display_name: string | null;
    custom_name: string | null;
    picture_url: string | null;
    unfollowed_at: string | null;
    link_method: "manual" | "code" | "liff_login" | null;
    created_at: string;
    assigned_to_user_id: string | null;
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

  // 求人共有 用 の 自組織 active 求人 一覧
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

  // 確定済 面談
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

  // 既読化:
  //   1) Maira DB の line_messages.read_at を 更新 (内部 未読 集計 用)
  //   2) LINE 側 にも 既読 信号 を 送る (求職者 の 1:1 トーク で 「既読」 表示)
  //      manual モード の Bot のみ 動作。 auto モード は 400 で 失敗 する が 既読 は 既に 自動。
  try {
    const admin = createServiceClient();
    await markConversationRead(admin, role.organization.id, lineUserId);

    const channelWithToken = await getLineChannelByOrgId(admin, role.organization.id);
    if (channelWithToken) {
      const result = await markChatAsRead(channelWithToken.channelAccessToken, lineUserId);
      if (!result.ok && result.status !== 400) {
        // 400 = auto モード や 仕様未対応 で 想定内。 それ以外 は warn ログ。
        console.warn("[line/mark-read] LINE markAsRead failed", {
          status: result.status,
          message: result.message,
        });
      }
    }
  } catch {
    // 既読化 失敗 は 致命的でない
  }

  // 組織 メンバー (担当者 セレクタ 用) + アバター URL
  const [{ data: membersData }, avatarMaps] = await Promise.all([
    supabase
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", role.organization.id)
      // soft delete された メンバー は 担当者 セレクタ に 出さない
      .is("removed_at", null),
    getOrgMemberAvatarMaps(supabase, role.organization.id),
  ]);
  // 表示名の解決:
  //   1. profiles.display_name (プロフィール設定で登録した氏名) を最優先
  //   2. auth.users.email のローカル部
  //   3. どちらもなければ 「(名前 未設定)」
  //  役職 (admin/advisor) の suffix は付けない (2026-07-09 修正)。
  //  RLS を通すため service_role で profiles を直接読み、email も
  //  同時取得して fallback に使う。
  const memberOptions = await (async () => {
    const rows = (membersData ?? []) as Array<{ user_id: string; role: string }>;
    if (rows.length === 0) return [];
    const admin = createServiceClient();
    const userIds = rows.map((r) => r.user_id);
    const [profilesRes, authLookups] = await Promise.all([
      admin.from("profiles").select("id, display_name").in("id", userIds),
      Promise.all(
        rows.map((r) =>
          admin.auth.admin
            .getUserById(r.user_id)
            .then((res) => res.data?.user?.email ?? null)
            .catch(() => null),
        ),
      ),
    ]);
    const displayNameByUserId = new Map<string, string | null>();
    for (const row of (profilesRes.data ?? []) as Array<{
      id: string;
      display_name: string | null;
    }>) {
      displayNameByUserId.set(row.id, row.display_name);
    }
    return rows.map((r, i) => {
      const displayName = displayNameByUserId.get(r.user_id);
      const email = authLookups[i];
      let label = "(名前 未設定)";
      if (displayName && displayName.trim().length > 0) {
        label = displayName.trim();
      } else if (email) {
        // email のローカル部を fallback として使う。
        // role suffix (「(admin)」等) は付けない。
        label = email.split("@")[0];
      }
      return {
        userId: r.user_id,
        displayName: label,
        avatarUrl: avatarMaps.byUserId.get(r.user_id) ?? null,
      };
    });
  })();

  return (
    <>
      {/* 開いた タイミング で サイドバー 未読バッジ を 更新 */}
      <SidebarRefresh lineUserId={lineUserId} />

      {/* 中央: ヘッダー + チャット + 入力欄 */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-100">
        <header className="flex items-center gap-3 border-b bg-white px-4 py-2.5">
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
            {/* CRM 側で紐付けた顧客名を優先。 未紐付けの場合は LINE プロフィール名を表示。 */}
            <p className="truncate text-sm font-semibold">
              {clientName ?? link.display_name ?? "(名前なし)"}
            </p>
            <p className="text-muted-foreground truncate text-[10px]">
              {clientName ? `LINE表示名: ${link.display_name ?? "(なし)"}` : "未紐付け"}
              {link.unfollowed_at && " · 解除済"}
            </p>
          </div>
          {/* モバイル 限定 「詳細」 リンク。 lg 未満 で は サイドバー が 非表示 と
              なる ため、 紐付け 先 の クライアント 詳細 へ ジャンプ できる 導線
              を ヘッダー に 出す (紐付け 無し なら 非表示)。 */}
          {link.client_record_id && (
            <a
              href={`/agency/clients/${link.client_record_id}`}
              className="text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium lg:hidden"
            >
              詳細
            </a>
          )}
        </header>

        <LineConversationClient
          lineUserId={lineUserId}
          initialMessages={messages}
          unfollowed={link.unfollowed_at !== null}
          jobOptions={jobOptions}
          scheduledMeetings={scheduledMeetings}
        />
      </div>

      {/* 右: 連絡先 詳細 */}
      <ContactDetailSidebar
        lineUserId={lineUserId}
        displayName={link.display_name}
        customName={link.custom_name}
        pictureUrl={link.picture_url}
        clientRecordId={link.client_record_id}
        clientName={clientName}
        linkMethod={link.link_method}
        unfollowedAt={link.unfollowed_at}
        createdAt={link.created_at}
        assigneeUserId={link.assigned_to_user_id}
        memberOptions={memberOptions}
      />
    </>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listConversations } from "@/lib/line/conversations";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * /agency/line
 *
 * LINE 公式アカウント の チャット 一覧 (LINE風 inbox)。
 *
 * 表示:
 *   ・最新メッセージ順 (未読 が 先)
 *   ・1 行 = (アイコン + 名前 + プレビュー + 時刻 + 未読バッジ)
 *   ・タップ → /agency/line/[lineUserId]
 *
 * 未連携 / 未紐付け も 表示 (ただし クライアント名 は 出ない)。
 */
export const dynamic = "force-dynamic";

export default async function AgencyLineInboxPage() {
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
  if (!channel) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">LINE 公式アカウント</h1>
        <Card className="p-6">
          <p className="text-sm">LINE 公式アカウント が まだ 接続 されて いません。</p>
          <p className="mt-2 text-sm">
            <Link href="/agency/settings/integrations/line" className="font-medium underline">
              連携設定 ページ →
            </Link>{" "}
            から 接続 して ください。
          </p>
        </Card>
      </div>
    );
  }

  const conversations = await listConversations(supabase);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">LINE トーク 一覧</h1>
        <div className="flex gap-3">
          <Link
            href="/agency/line/broadcasts"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            一斉配信 →
          </Link>
          <Link
            href="/agency/line/users"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            友達 / 紐付け →
          </Link>
        </div>
      </div>

      {conversations.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm">まだ 友達 が いません。</p>
          <p className="text-muted-foreground mt-2 text-xs">
            求職者 に 公式LINE の 友達追加 URL を 案内 する と、 友達追加 後 ここに 表示 されます。
          </p>
        </Card>
      ) : (
        <div className="divide-y rounded-md border bg-white">
          {conversations.map((c) => (
            <Link
              key={c.lineUserId}
              href={`/agency/line/${encodeURIComponent(c.lineUserId)}`}
              className="hover:bg-muted/50 flex items-start gap-3 p-3 transition-colors"
            >
              {c.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.pictureUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full bg-slate-200 object-cover"
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded-full bg-slate-200" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold">
                    {c.displayName ?? "(名前なし)"}
                    {c.clientName && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-emerald-800">
                        {c.clientName}
                      </span>
                    )}
                    {c.unfollowedAt && (
                      <span className="bg-muted text-muted-foreground ml-2 rounded-full px-1.5 py-0.5 align-middle text-[10px]">
                        解除済
                      </span>
                    )}
                  </p>
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {c.lastMessageAt
                      ? new Date(c.lastMessageAt).toLocaleString("ja-JP", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-muted-foreground truncate text-xs">
                    {c.lastMessageDirection === "outbound" && (
                      <span className="mr-1 text-slate-400">あなた:</span>
                    )}
                    {c.lastMessagePreview ?? "(メッセージなし)"}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

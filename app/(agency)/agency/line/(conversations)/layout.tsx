import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { listConversations } from "@/lib/line/conversations";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { ActiveSync } from "./active-sync";
import { ConversationListSidebar } from "./conversation-list-sidebar";

/**
 * LINE 統合 3 カラム layout (LINE Official Account Manager 風)
 *
 * 左:会話一覧 (常時 表示)
 * 中央:children (個別 チャット or 空状態)
 * 右:個別ページ 側 で 連絡先 詳細 を 表示
 *
 * 設計判断:
 *   ・layout レベル で 会話一覧 を SSR 取得 (毎ナビゲーション で 再実行)
 *   ・active な lineUserId は ActiveSync (Client Component) が pathname から 抽出
 *     して props 経由 で sidebar に 伝達 (React Server Component の 制約 回避)
 */
export const dynamic = "force-dynamic";

export default async function AgencyLineLayout({ children }: { children: React.ReactNode }) {
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
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-2xl font-bold">LINE 公式アカウント</h1>
        <Card className="p-6">
          <p className="text-sm">LINE 公式アカウント が まだ 接続 されて いません。</p>
          <p className="mt-2 text-sm">
            <Link href="/agency/settings/integrations/line" className="font-medium underline">
              連携設定 ページ →
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const conversations = await listConversations(supabase);

  // 親 (agency layout) は h-screen overflow-hidden で、 main は flex-1 overflow-auto p-6。
  // ここ は main の 残り 領域 を 縁無し で 100% 使う ため、 -m-6 で padding を 打消し、
  // 高さ は h-[calc(100%+3rem)] (= padding 分 を 足し戻す) で 100% を 取り戻す。
  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] overflow-hidden border-t bg-slate-100">
      {/* 左:会話一覧 */}
      <div className="w-72 shrink-0">
        <ActiveSync conversations={conversations} />
      </div>

      {/* 中央 + 右 は children 内で 完結 */}
      <div className="flex flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

// ConversationListSidebar の active 表示を Client から 同期 するための 補助 を 同梱で 公開
export { ConversationListSidebar };

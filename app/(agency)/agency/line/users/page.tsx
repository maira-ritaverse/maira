import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { LineUsersClient } from "./line-users-client";

/**
 * /agency/line/users
 *
 * LINE 公式アカウント の 友達一覧 + Maira client_records への 紐付け 管理。
 *
 * 状態 別 タブ:
 *   ・未紐付け (友達 だが client_record に 紐付け されていない)
 *   ・紐付け済 (client_record と マッチ している)
 *   ・ブロック / 友達解除 (unfollowed)
 *
 * 紐付け 操作:
 *   ・client_record を セレクトで 選び → 紐付け
 *   ・連携コード を 発行 (LINE で 入力して もらう 形式)
 *
 * admin / advisor 両方 操作可能。
 */
export default async function LineUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const channel = await getMyLineChannel(supabase);
  if (!channel) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">LINE 友達 / 紐付け</h1>
        <Card className="p-6">
          <p className="text-sm">LINE 公式アカウント が まだ 接続 されて いません。</p>
          <p className="mt-2 text-sm">
            <a href="/agency/settings/integrations/line" className="font-medium underline">
              連携設定 ページ →
            </a>{" "}
            から 接続 して ください。
          </p>
        </Card>
      </div>
    );
  }

  // 紐付け 候補 用 に 自組織の client_records 一覧 を 取得
  const { data: clientsData } = await supabase
    .from("client_records")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(1000);
  const clientOptions = ((clientsData ?? []) as Array<{ id: string; name: string }>).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">LINE 友達 / 紐付け</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          公式LINE の 友達 と Maira の クライアント (求職者) を 紐付けます。 紐付け 済みの 求職者 と
          は LINE で やり取り が 可能 に なります。
        </p>
      </div>

      <LineUsersClient clientOptions={clientOptions} />
    </div>
  );
}

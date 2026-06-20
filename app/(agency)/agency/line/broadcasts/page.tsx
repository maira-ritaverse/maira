import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { BroadcastHistory } from "./broadcasts-client";

/**
 * /agency/line/broadcasts
 *
 * LINE 一斉配信 履歴 ページ。
 *
 * 新規 配信 の 作成 は サイドバー の 「LINE設定」 (/agency/line/settings) で
 * 行う 設計 に 分離 した。 ここ は 過去 の 配信 結果 を 閲覧 する 専用 画面。
 */
export const dynamic = "force-dynamic";

export default async function LineBroadcastsPage() {
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
        <h1 className="text-2xl font-bold">LINE 一斉配信 履歴</h1>
        <Card className="p-6">
          <p className="text-sm">
            LINE 公式アカウント が まだ 接続 されて いません。{" "}
            <Link href="/agency/settings/integrations/line" className="font-medium underline">
              連携設定 →
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">LINE 一斉配信 履歴</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/agency/line"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            ← トーク 一覧
          </Link>
          <Button
            size="sm"
            className="bg-[#06C755] text-white hover:bg-[#05a647]"
            render={<Link href="/agency/line/settings" />}
          >
            新規 配信 を 作成
          </Button>
        </div>
      </div>

      <BroadcastHistory />
    </div>
  );
}

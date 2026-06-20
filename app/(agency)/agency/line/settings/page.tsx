import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { BroadcastForm } from "../broadcasts/broadcasts-client";

/**
 * /agency/line/settings
 *
 * LINE 設定 (新規 一斉配信 を 作成 する 画面)。
 *
 * サイドバー の 「LINE設定」 から 来る 想定:
 *   ・新規 配信 を 「設定」 する (テキスト / 求人 / ターゲット / 予約)
 *   ・履歴 は 別 ページ (/agency/line/broadcasts) に 分離
 *
 * 「LINE トーク 一覧 + 受信 既読」は /agency/line。
 * 「公式 LINE チャネル の 連携 設定」 は /agency/settings/integrations/line。
 */
export const dynamic = "force-dynamic";

export default async function LineSettingsPage() {
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
        <h1 className="text-2xl font-bold">LINE 設定</h1>
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

  // 友達 数 + 配信 候補 求人 を 並列 で 取得 (broadcasts/page.tsx と 同じ)
  type CountResult = { count: number | null };
  const [allCount, linkedCount, unlinkedCount, jobsResult] = await Promise.all([
    supabase
      .from("line_user_links")
      .select("id", { count: "exact", head: true })
      .is("unfollowed_at", null)
      .then((r) => (r as unknown as CountResult).count ?? 0),
    supabase
      .from("line_user_links")
      .select("id", { count: "exact", head: true })
      .is("unfollowed_at", null)
      .not("client_record_id", "is", null)
      .then((r) => (r as unknown as CountResult).count ?? 0),
    supabase
      .from("line_user_links")
      .select("id", { count: "exact", head: true })
      .is("unfollowed_at", null)
      .is("client_record_id", null)
      .then((r) => (r as unknown as CountResult).count ?? 0),
    supabase
      .from("job_postings")
      .select("id, company_name, position, status, created_at")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  type JobPickerRow = {
    id: string;
    company_name: string;
    position: string;
    status: string;
    created_at: string;
  };
  const jobs = ((jobsResult.data ?? []) as JobPickerRow[]).map((j) => ({
    id: j.id,
    companyName: j.company_name,
    position: j.position,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">LINE 設定 (新規 一斉配信)</h1>
        <Link
          href="/agency/line/broadcasts"
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          配信 履歴 →
        </Link>
      </div>

      <p className="text-muted-foreground text-sm">
        テキスト / 求人 カード を 友達 全員 (or 連携済 のみ) に 一斉 配信 します。 日時 を 指定 して
        予約 配信 も できます。
      </p>

      <BroadcastForm
        allCount={allCount}
        linkedCount={linkedCount}
        unlinkedCount={unlinkedCount}
        jobs={jobs}
      />
    </div>
  );
}

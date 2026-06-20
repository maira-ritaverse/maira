import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { getMyLineChannel } from "@/lib/line/queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { BroadcastsClient } from "./broadcasts-client";

/**
 * /agency/line/broadcasts
 *
 * 一斉配信 (LINE Multicast) ページ。
 *
 * 機能:
 *   ・配信 作成 (テキスト、 ターゲット = 全 / 連携済 / 未連携)
 *   ・配信履歴 + 統計 (sent / failed / 課金通数)
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
        <h1 className="text-2xl font-bold">LINE 一斉配信</h1>
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

  // 友達数 を 取得 (UI 表示 用)
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
    // 配信 候補 求人 (公開中、 最大 50 件、 最新 順)。 UI で picker から 選択 する。
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
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">LINE 一斉配信</h1>
          <Link
            href="/agency/line"
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            ← トーク 一覧
          </Link>
        </div>

        <BroadcastsClient
          allCount={allCount}
          linkedCount={linkedCount}
          unlinkedCount={unlinkedCount}
          jobs={jobs}
        />
      </div>
    </div>
  );
}

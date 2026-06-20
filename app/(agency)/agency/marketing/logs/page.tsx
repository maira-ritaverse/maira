import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listScenarioViews, listSendLogs } from "@/lib/ma/queries";
import { parseLogDateRange, parseLogPage, parseLogStatus } from "@/lib/ma/logs-filters";
import { Button } from "@/components/ui/button";
import { LogsTable } from "./logs-table";

/**
 * MA 送信履歴画面
 *
 * /agency/marketing/logs
 *
 * 直近 100 件を復号して表示。シナリオ別フィルタは searchParams で受け取る。
 * admin と advisor 両方が閲覧可(RLS の SELECT は同 org メンバー全員)。
 *
 * MVP では「status / scenario」の絞り込みだけ提供。日付範囲・受信者検索は
 * 件数増加してから追加検討。
 */
export default async function MarketingLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    scenario?: string;
    status?: string;
    channel?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  // フィルタ解釈は lib/ma/logs-filters.ts に集約(CSV エクスポート API と共有・テスト済み)。
  // 不正値は黙って全体表示に倒す方針。
  const statusFilter = parseLogStatus(sp.status);
  const scenarioFilter = sp.scenario && sp.scenario.length > 0 ? sp.scenario : undefined;
  const channelFilter = sp.channel === "email" || sp.channel === "line" ? sp.channel : undefined;
  const { dateFrom, dateTo } = parseLogDateRange(sp.from, sp.to);

  // ページ番号:1 始まり。
  // 「次ページがあるか」を判定するため limit+1 件を取得し、ハミ出した最後の 1 件は表示しない。
  const PAGE_SIZE = 100;
  const pageNum = parseLogPage(sp.page);
  const offset = (pageNum - 1) * PAGE_SIZE;

  // シナリオ名解決のためにビューも取る(scenario_id → preset.name の Map をテーブル側に渡す)
  const [logsPlusOne, scenarios] = await Promise.all([
    listSendLogs(role.organization.id, {
      scenarioId: scenarioFilter,
      status: statusFilter,
      channel: channelFilter,
      dateFrom,
      dateTo,
      limit: PAGE_SIZE + 1,
      offset,
    }),
    listScenarioViews(role.organization.id),
  ]);

  // PAGE_SIZE+1 件取れたら「次ページあり」。最後の 1 件は表示用配列からは除外。
  const hasNextPage = logsPlusOne.length > PAGE_SIZE;
  const logs = hasNextPage ? logsPlusOne.slice(0, PAGE_SIZE) : logsPlusOne;

  const scenarioNameById = new Map<string, string>();
  for (const v of scenarios) {
    if (v.activation) scenarioNameById.set(v.activation.id, v.preset.name);
  }

  // フィルタ用に「現在の組織で有効化されたシナリオ」をプルダウンに出す
  const filterOptions = scenarios
    .filter((v) => v.activation)
    .map((v) => ({ id: v.activation!.id, name: v.preset.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-xs">
            <Link href="/agency/marketing" className="hover:underline">
              マーケティング
            </Link>{" "}
            / 送信履歴
          </p>
          <h1 className="mt-1 text-2xl font-bold">送信履歴</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            直近 100 件の MA 自動配信の結果(復号して表示)
          </p>
        </div>
        <Button variant="outline" render={<Link href="/agency/marketing" />}>
          一覧に戻る
        </Button>
      </div>

      {/* UI 側にも生の YYYY-MM-DD を渡す。dateFrom/dateTo が valid なら sp.from/sp.to もそのまま使える。 */}
      <LogsTable
        logs={logs}
        scenarioNameById={Object.fromEntries(scenarioNameById)}
        filterOptions={filterOptions}
        currentScenarioId={scenarioFilter}
        currentStatus={statusFilter}
        currentChannel={channelFilter}
        currentFrom={dateFrom ? sp.from : undefined}
        currentTo={dateTo ? sp.to : undefined}
        currentPage={pageNum}
        hasNextPage={hasNextPage}
      />
    </div>
  );
}

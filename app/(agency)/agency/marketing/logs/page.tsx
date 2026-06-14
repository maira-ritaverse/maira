import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { listScenarioViews, listSendLogs } from "@/lib/ma/queries";
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
  searchParams: Promise<{ scenario?: string; status?: string }>;
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

  // status の絞り込みは Zod 経由ではなく軽量に文字列マッチ(URL を直接打たれても安全に倒す)
  const statusFilter =
    sp.status === "sent" || sp.status === "failed" || sp.status === "skipped"
      ? sp.status
      : undefined;
  const scenarioFilter = sp.scenario && sp.scenario.length > 0 ? sp.scenario : undefined;

  // シナリオ名解決のためにビューも取る(scenario_id → preset.name の Map をテーブル側に渡す)
  const [logs, scenarios] = await Promise.all([
    listSendLogs(role.organization.id, {
      scenarioId: scenarioFilter,
      status: statusFilter,
      limit: 100,
    }),
    listScenarioViews(role.organization.id),
  ]);

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

      <LogsTable
        logs={logs}
        scenarioNameById={Object.fromEntries(scenarioNameById)}
        filterOptions={filterOptions}
        currentScenarioId={scenarioFilter}
        currentStatus={statusFilter}
      />
    </div>
  );
}

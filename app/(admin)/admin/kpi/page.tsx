import { Card } from "@/components/ui/card";

import { KpiDashboard } from "./kpi-dashboard";

/**
 * /admin/kpi
 *
 * 運営者用:プラットフォーム KPI ダッシュボード。
 * 累計 + 直近 30 日の主要指標を一覧表示。
 */
export default function AdminKpiPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">KPI ダッシュボード</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          プラットフォーム全体の累計指標 + 直近 30 日のアクティビティ。
        </p>
      </div>
      <Card className="p-6">
        <KpiDashboard />
      </Card>
    </div>
  );
}

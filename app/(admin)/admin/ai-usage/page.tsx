import { Card } from "@/components/ui/card";

import { AiUsageDashboard } from "./ai-usage-dashboard";

/**
 * /admin/ai-usage
 *
 * 運営者用:AI 利用量モニタ。
 * - 今月の総数 / kind 別 / ユニークユーザ数
 * - 直近 6 か月の月別推移
 *
 * 将来:単価情報を持たせて月次コスト見積りも算出。
 */
export default function AdminAiUsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI 利用量</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          ai_usage_events を集計。今月のコスト + 月別推移 + kind 別内訳を俯瞰します。
        </p>
      </div>
      <Card className="p-6">
        <AiUsageDashboard />
      </Card>
    </div>
  );
}

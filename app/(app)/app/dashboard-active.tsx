import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { applicationStatusLabels } from "@/lib/applications/types";
import { DashboardSuggestions } from "./dashboard-suggestions";
import { generateSuggestions } from "@/lib/dashboard/suggestions";
import type { DashboardData } from "@/lib/dashboard/queries";

type Props = {
  data: DashboardData;
};

/**
 * 進行中の応募が複数あるアクティブユーザー向けのダッシュボード。
 *
 * Phase 2 の変更:
 * - 「期限が迫っているタスク」専用セクションを削除
 *   (overdue / dueToday はサジェストに集約されるため重複回避)
 * - サジェストを最上部に配置(行動の起点として優先表示)
 * - 4 機能動線の右側を「タスク」に置き換え、/app/tasks の横断ビューへ誘導
 */
export function DashboardActive({ data }: Props) {
  const suggestions = generateSuggestions(data);

  return (
    <div className="space-y-6">
      {/* キャリアサマリー(コンパクト版) */}
      {data.career.profileData && (
        <Card className="border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="line-clamp-2 flex-1 text-sm">{data.career.profileData.summary}</p>
            <Button render={<Link href="/app/career" />} variant="outline" size="sm">
              詳細
            </Button>
          </div>
        </Card>
      )}

      <DashboardSuggestions suggestions={suggestions} maxDisplay={3} />

      {/* 進行中の応募(最大5件) */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">進行中の応募</h2>
          <Button render={<Link href="/app/applications" />} variant="outline" size="sm">
            すべて見る
          </Button>
        </div>
        {data.applications.inProgress.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">進行中の応募はありません</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.applications.inProgress.slice(0, 5).map((app) => (
              <Link
                key={app.id}
                href={`/app/applications/${app.id}`}
                className="hover:bg-accent block rounded-lg border p-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{app.details.company}</p>
                  <span className="bg-muted rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                    {applicationStatusLabels[app.status]}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {app.details.position}
                </p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* 他機能への動線 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="font-medium">📝 書類作成</p>
          <p className="text-muted-foreground mt-1 text-xs">{data.documents.count}件作成済み</p>
          <Button
            render={<Link href="/app/documents" />}
            variant="outline"
            size="sm"
            className="mt-3"
          >
            書類を見る
          </Button>
        </Card>
        <Card className="p-4">
          <p className="font-medium">📋 タスク</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {data.tasks.total}件
            {data.tasks.overdue.length > 0 && ` (期限超過 ${data.tasks.overdue.length})`}
          </p>
          <Button render={<Link href="/app/tasks" />} variant="outline" size="sm" className="mt-3">
            タスクを見る
          </Button>
        </Card>
      </div>
    </div>
  );
}

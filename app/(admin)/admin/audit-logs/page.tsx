import { Card } from "@/components/ui/card";

import { AuditLogsTable } from "./audit-logs-table";

/**
 * /admin/audit-logs
 *
 * 運営者用:監査ログ閲覧。
 * 直近 100 件 + action フィルタで絞り込み。
 */
export default function AdminAuditLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">監査ログ</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          重要操作(ログイン / 削除 / エクスポート / 管理者操作 等)の履歴。 CSV
          ダウンロードで法令対応の控えにも対応。
        </p>
      </div>
      <Card className="p-6">
        <AuditLogsTable />
      </Card>
    </div>
  );
}

import { Card } from "@/components/ui/card";

import { UsersTable } from "./users-table";

/**
 * /admin/users
 *
 * 運営者用:ユーザ一覧 / 検索 / 強制削除。
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 *
 * 一覧は Client Component で fetch:メアド検索の入力に応じて再取得が必要なため。
 */
export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">ユーザ管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          すべてのユーザ(求職者 / エージェント企業メンバー / 運営者)の一覧。メアド検索 + 強制削除。
        </p>
      </div>
      <Card className="p-4">
        <UsersTable />
      </Card>
    </div>
  );
}

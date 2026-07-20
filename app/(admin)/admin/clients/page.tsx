import { Card } from "@/components/ui/card";

import { ClientsTable } from "./clients-table";

/**
 * /admin/clients
 *
 * 運営者用: 各 CA 企業 が 自社 CRM に 登録 した 求職者 (client_records) を
 * 全社 横断 で 一覧。
 *
 * 「/admin/seekers」 は 「Maira に 直接 登録 した 求職者 本人」 の 一覧、
 * こちら は 「CA が 案件 管理 の 為 に 登録 して いる 求職者」 の 一覧 で、
 * 別 の 業務目的。 リンク 済 (link_status='linked') の レコード は 両方 に 出る。
 *
 * 表示 は 基本 プロフィール (平文 フィールド) の み。 暗号化 の 内部 メモ
 * (推薦文 / 面談メモ / ステータス メモ 等) は 詳細 ページ で トグル 展開 +
 * audit ログ 記録 で 見せる (Phase 2 で 実装 予定)。
 *
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 */
export const dynamic = "force-dynamic";

export default function AdminClientsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">求職者 CRM(全企業)</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          各エージェント企業が自社 CRM に登録している求職者の全社横断一覧。企業 / ステータス /
          名前で絞り込めます。基本プロフィールのみ表示、暗号化された内部メモ(推薦文・面談メモ等)は
          個別レコードの詳細ページで確認できます。
        </p>
      </div>
      <Card className="p-4">
        <ClientsTable />
      </Card>
    </div>
  );
}

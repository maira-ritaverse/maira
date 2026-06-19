import { Card } from "@/components/ui/card";

import { SeekerBoostsSection } from "./seeker-boosts-section";

/**
 * /admin/payments
 *
 * 課金 / 売上 監視 ページ。
 *
 * 現在表示:
 *   ・求職者 ドキュメント作成 ブーストチケット (¥2,000 / 3 ヶ月有効)
 *
 * 将来追加 想定:
 *   ・エージェント企業 Pro プラン 契約一覧
 *   ・サブスクリプション アドオン
 *   ・返金 / 失効 履歴
 *
 * /admin/* layout で isMairaAdmin ガード済み。
 */
export default function AdminPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">課金 / 売上</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Stripe 経由 の 単発課金 / サブスクリプション の 履歴 を 一覧します。 ※ Stripe 連携 未完了
          の 期間 は 0 件 表示が 正常 です。
        </p>
      </div>
      <Card className="p-6">
        <SeekerBoostsSection />
      </Card>
    </div>
  );
}

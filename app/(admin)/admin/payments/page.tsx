import { Card } from "@/components/ui/card";

import { BillingOverviewSections } from "./billing-overview-sections";
import { SeekerBoostsSection } from "./seeker-boosts-section";

/**
 * /admin/payments
 *
 * 課金 / 売上 監視 ページ。
 *
 * 表示する セクション:
 *   1. 求職者 ドキュメント作成 ブーストチケット (¥2,000 / 3 ヶ月有効)
 *   2. エージェント企業 プラン 契約一覧 (Standard / 録音 / Pro / Premium の 4 ティア)
 *   3. サブスクリプション アドオン (meeting_recording_auto 等)
 *   4. 返金 / 失効 履歴
 *
 * /admin/* layout で isMairaAdmin ガード済み。
 */
export default function AdminPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">課金 / 売上</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Stripe 経由 の 単発課金 / サブスクリプション / アドオン の 履歴 を 一覧します。 ※ Stripe
          連携 未完了 の 期間 は 0 件 表示が 正常 です。
        </p>
      </div>
      <Card className="p-6">
        <SeekerBoostsSection />
      </Card>
      <Card className="p-6">
        <BillingOverviewSections />
      </Card>
    </div>
  );
}

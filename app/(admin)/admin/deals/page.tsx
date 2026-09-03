/**
 * /admin/deals
 *
 * 運営の営業パイプライン(商談一覧)。Myaira を売る営業先の会社を、ステージつきで管理する。
 * /admin/* レイアウトで isMairaAdmin ガード済み。データは lib/sales/queries 経由(暗号化境界)。
 */
import { listProspects } from "@/lib/sales/queries";

import { DealsClient } from "./deals-client";

export default async function AdminDealsPage() {
  const prospects = await listProspects();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">商談管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Myaira の営業先(商談)をステージつきで管理します。各商談の詳細でミーティングの録音を
          取り込み、AI が議事録と次アクションを提案します。
        </p>
      </div>
      <DealsClient initialProspects={prospects} />
    </div>
  );
}

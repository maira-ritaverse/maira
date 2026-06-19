import Link from "next/link";

import { Card } from "@/components/ui/card";

import { OrganizationDetail } from "./organization-detail";
import { PlatformAiQuotasSection } from "./platform-ai-quotas-section";

/**
 * /admin/organizations/[id]
 *
 * 1 つのエージェント企業の詳細。
 * - 統計(admin / advisor / clients / linked / jobs)
 * - メンバー一覧 + 各メンバーの担当クライアント数
 * - 未アサインクライアント数
 *
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 */
export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/organizations" className="text-muted-foreground text-sm hover:underline">
          ← 企業一覧に戻る
        </Link>
      </div>
      <Card className="p-6">
        <OrganizationDetail organizationId={id} />
      </Card>
      <Card className="p-6">
        <PlatformAiQuotasSection organizationId={id} />
      </Card>
    </div>
  );
}

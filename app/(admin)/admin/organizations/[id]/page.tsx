import Link from "next/link";

import { Card } from "@/components/ui/card";
import { getBillingExemption } from "@/lib/billing/exemption";
import { createServiceClient } from "@/lib/supabase/service";

import { BillingExemptSection } from "./billing-exempt-section";
import { NdaRequestSection } from "./nda-request-section";
import { OrganizationDetail } from "./organization-detail";
import { PlanTierSection } from "./plan-tier-section";
import { PlatformAiQuotasSection } from "./platform-ai-quotas-section";

/**
 * /admin/organizations/[id]
 *
 * 1 つのエージェント企業の詳細。
 * - 統計(admin / advisor / clients / linked / jobs)
 * - メンバー一覧 + 各メンバーの担当クライアント数
 * - 未アサインクライアント数
 * - 課金 免除 トグル ( admin が 個別 ON/OFF )
 *
 * /admin/* レイアウト側で isMairaAdmin ガード済み。
 */
export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const exemption = await getBillingExemption(id);

  // プラン種別 / メンバー数 / NDA 同意状態を取得(/admin レイアウトで isMairaAdmin ガード済み)。
  const admin = createServiceClient();
  const [{ data: planRow }, { count: memberCount }, { data: ndaRow }] = await Promise.all([
    admin.from("organization_plans").select("tier").eq("organization_id", id).maybeSingle(),
    admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", id)
      .is("removed_at", null),
    admin
      .from("organizations")
      .select("nda_accepted_at, nda_signer_name")
      .eq("id", id)
      .maybeSingle(),
  ]);
  const currentTier = (planRow as { tier?: string } | null)?.tier ?? "standard";
  const nda = ndaRow as { nda_accepted_at?: string | null; nda_signer_name?: string | null } | null;

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
        <BillingExemptSection
          organizationId={id}
          initialIsExempt={exemption.isExempt}
          initialReason={exemption.reason}
          initialSetAt={exemption.setAt}
        />
      </Card>
      <Card className="p-6">
        <PlanTierSection
          organizationId={id}
          initialTier={currentTier}
          memberCount={memberCount ?? 0}
        />
      </Card>
      <Card className="p-6">
        <NdaRequestSection
          organizationId={id}
          ndaAccepted={Boolean(nda?.nda_accepted_at)}
          ndaSignerName={nda?.nda_signer_name ?? null}
        />
      </Card>
      <Card className="p-6">
        <PlatformAiQuotasSection organizationId={id} />
      </Card>
    </div>
  );
}

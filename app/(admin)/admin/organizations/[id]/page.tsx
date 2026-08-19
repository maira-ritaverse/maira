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
      .select("nda_accepted_at, nda_signer_name, terms_accepted_at, terms_signer_name")
      .eq("id", id)
      .maybeSingle(),
  ]);
  const currentTier = (planRow as { tier?: string } | null)?.tier ?? "standard";
  const docs = ndaRow as {
    nda_accepted_at?: string | null;
    nda_signer_name?: string | null;
    terms_accepted_at?: string | null;
    terms_signer_name?: string | null;
  } | null;

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
          ndaAccepted={Boolean(docs?.nda_accepted_at)}
          ndaSignerName={docs?.nda_signer_name ?? null}
        />
      </Card>
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">署名済み書類のダウンロード</h2>
            <p className="text-muted-foreground text-sm">
              この組織が署名した秘密保持契約(NDA)と利用規約を PDF
              でダウンロードできます(署名者・日時・所在地の記録入り)。
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded border p-3">
            <div className="min-w-0">
              <p className="font-medium">秘密保持契約(NDA)</p>
              <p className="text-muted-foreground text-xs">
                {docs?.nda_accepted_at
                  ? `署名済み${docs.nda_signer_name ? `(署名者:${docs.nda_signer_name})` : ""}・${formatJstDateTime(docs.nda_accepted_at)}`
                  : "未署名"}
              </p>
            </div>
            {docs?.nda_accepted_at ? (
              <a
                href={`/api/admin/organizations/${id}/nda/pdf`}
                className="border-input hover:bg-accent shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
              >
                ダウンロード
              </a>
            ) : (
              <span className="text-muted-foreground shrink-0 text-xs">—</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded border p-3">
            <div className="min-w-0">
              <p className="font-medium">利用規約</p>
              <p className="text-muted-foreground text-xs">
                {docs?.terms_accepted_at
                  ? `署名済み${docs.terms_signer_name ? `(署名者:${docs.terms_signer_name})` : ""}・${formatJstDateTime(docs.terms_accepted_at)}`
                  : "未署名"}
              </p>
            </div>
            {docs?.terms_accepted_at ? (
              <a
                href={`/api/admin/organizations/${id}/terms/pdf`}
                className="border-input hover:bg-accent shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
              >
                ダウンロード
              </a>
            ) : (
              <span className="text-muted-foreground shrink-0 text-xs">—</span>
            )}
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <PlatformAiQuotasSection organizationId={id} />
      </Card>
    </div>
  );
}

/** 署名日時を Asia/Tokyo で "YYYY/MM/DD HH:mm" 表示(UTC 前日ズレを避ける)。 */
function formatJstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

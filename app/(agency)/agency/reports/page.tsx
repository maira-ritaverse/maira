import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import {
  getAdvisorPerformance,
  getClientStatusDistribution,
  getMonthlyDealsRevenue,
  getPhaseDuration,
  getPlacementRate,
  getReferralStatusDistribution,
  getSelectionFunnel,
  getSelectionFunnelByCandidate,
  resolvePeriod,
  type PeriodPreset,
} from "@/lib/reports/queries";
import { ExportButton } from "@/components/features/agency/export-button";
import { PeriodFilter } from "./period-filter";
import { StatusDistributionSection } from "./status-distribution-section";
import { MonthlyDealsSection } from "./monthly-deals-section";
import { PlacementRateSection } from "./placement-rate-section";
import { SelectionFunnelSection } from "./selection-funnel-section";
import { AdvisorPerformanceSection } from "./advisor-performance-section";
import { PhaseDurationSection } from "./phase-duration-section";

/**
 * エージェント向けレポート画面(土台 + D:ステータス分布)
 *
 * レポートは organization スコープで自社のデータのみ表示する。
 * 期間フィルタは URL searchParams で持ち、ここで Period に解決する。
 *
 * memberRole(admin / advisor)は今回は使わないが、後続の C(アドバイザー別)で
 * 「admin は全員分、一般は自分の分」を出すために土台として保持。
 *
 * セクションは Card 単位で縦に並べる構造にしてある。
 * 後で A(成約・売上)/ B(ファネル)/ C(アドバイザー別)/ E(所要日数)を
 * このページに足していく。
 */
type SearchParams = Promise<{ period?: string; from?: string; to?: string }>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (role.accountType !== "organization_member" || !role.organization || !role.member) {
    redirect("/app");
  }

  const params = await searchParams;
  const preset = normalizePeriodPreset(params.period);
  const period = resolvePeriod(preset, params.from, params.to);

  // 🔴 C(アドバイザー別)はサーバー側で権限フィルタを掛ける。
  //    advisor の場合、自分のデータしか取得しないため、devtools でも他人のデータは見えない。
  const viewer = {
    memberId: role.member.id,
    userId: user.id,
    isAdmin: role.member.role === "admin",
  };

  // 後続レポートの並行取得を見越して Promise.all で固める。
  // ファネルは「応募ベース」「求職者ベース」の 2 視点を別関数で取得して両方渡す。
  const [
    clients,
    referrals,
    monthlyDeals,
    placementRate,
    funnelByApplication,
    funnelByCandidate,
    advisor,
    phaseDuration,
  ] = await Promise.all([
    getClientStatusDistribution(role.organization.id),
    getReferralStatusDistribution(role.organization.id),
    getMonthlyDealsRevenue(role.organization.id, period),
    getPlacementRate(role.organization.id, period),
    getSelectionFunnel(role.organization.id, period),
    getSelectionFunnelByCandidate(role.organization.id, period),
    getAdvisorPerformance(role.organization.id, viewer, period),
    getPhaseDuration(role.organization.id, period),
  ]);

  const showExport = canExport(role);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">レポート</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {role.organization.name} の活動状況をまとめます
          </p>
        </div>
        {showExport && (
          <div className="flex flex-col items-end gap-2">
            <ExportButton href="/api/agency/export/placements" label="成約・売上 CSV" />
            <ExportButton href="/api/agency/export/referrals" label="応募 CSV" />
          </div>
        )}
      </div>

      <PeriodFilter period={period} />

      <div className="space-y-4">
        <StatusDistributionSection clients={clients} referrals={referrals} />
        <MonthlyDealsSection data={monthlyDeals} />
        <PlacementRateSection data={placementRate} />
        <SelectionFunnelSection application={funnelByApplication} candidate={funnelByCandidate} />
        <AdvisorPerformanceSection data={advisor} />
        <PhaseDurationSection data={phaseDuration} />
      </div>
    </div>
  );
}

/**
 * URL から流れてくる period 文字列を PeriodPreset に narrow する。
 * 不正値や未指定は this-month にフォールバック。
 */
function normalizePeriodPreset(raw: string | undefined): PeriodPreset {
  if (raw === "last-month" || raw === "custom") return raw;
  return "this-month";
}

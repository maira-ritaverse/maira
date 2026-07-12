import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import {
  computePreviousPeriod,
  getAchievementForPeriod,
  getAdvisorPerformance,
  getClientStatusDistribution,
  getCompanyReport,
  getEntrySourceReport,
  getKpiSummary,
  getMonthlyDealsRevenue,
  getMonthlyTrend,
  getPhaseDuration,
  getPlacementRate,
  getReferralStatusDistribution,
  getRoiSummary,
  getSelectionFunnel,
  getSelectionFunnelByCandidate,
  resolvePeriod,
  type PeriodPreset,
} from "@/lib/reports/queries";
import { AchievementSection } from "./achievement-section";
import { AdvisorPerformanceSection } from "./advisor-performance-section";
import { CompanyReportSection } from "./company-report-section";
import { EntrySourceSection } from "./entry-source-section";
import { ExportMenu } from "./export-menu";
import { KpiHeadline } from "./kpi-headline";
import { MonthlyDealsSection } from "./monthly-deals-section";
import { PeriodFilter } from "./period-filter";
import { PhaseDurationSection } from "./phase-duration-section";
import { PlacementRateSection } from "./placement-rate-section";
import { PrintButton } from "./print-button";
import { RoiSection } from "./roi-section";
import { SectionNav } from "./section-nav";
import { SelectionFunnelSection } from "./selection-funnel-section";
import { StatusDistributionSection } from "./status-distribution-section";
import { TrendSection } from "./trend-section";

/**
 * エージェント向けレポート画面(充実版)
 *
 * セクション構成:
 *   1. KPI ヘッドライン(4 タイル + 前期比)
 *   2. 目標達成率(月次目標が入っていれば)
 *   3. ROI(admin 限定・コストが入っていれば)
 *   4. 時系列トレンド(過去 12 か月)
 *   5. 成約・売上(月別)
 *   6. 成約率
 *   7. 選考ファネル
 *   8. 企業別レポート
 *   9. エントリーサイト別
 *  10. アドバイザー別成績
 *  11. 所要日数
 *  12. ステータス分布(スナップショット)
 *
 * ・md 以上でサイドバーに sticky セクションナビ
 * ・admin のみ設定リンク / ROI が表示される
 * ・PrintButton で印刷 / PDF 出力(サイドバーは非表示化)
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
  const previousPeriod = computePreviousPeriod(period);
  const isAdmin = role.member.role === "admin";

  const viewer = {
    memberId: role.member.id,
    userId: user.id,
    isAdmin,
  };

  const [
    kpiCurrent,
    kpiPrevious,
    trend,
    clients,
    referrals,
    monthlyDeals,
    placementRate,
    funnelByApplication,
    funnelByCandidate,
    advisor,
    phaseDuration,
    companyReport,
    entrySourceReport,
  ] = await Promise.all([
    getKpiSummary(role.organization.id, period),
    getKpiSummary(role.organization.id, previousPeriod),
    getMonthlyTrend(role.organization.id),
    getClientStatusDistribution(role.organization.id),
    getReferralStatusDistribution(role.organization.id),
    getMonthlyDealsRevenue(role.organization.id, period),
    getPlacementRate(role.organization.id, period),
    getSelectionFunnel(role.organization.id, period),
    getSelectionFunnelByCandidate(role.organization.id, period),
    getAdvisorPerformance(role.organization.id, viewer, period),
    getPhaseDuration(role.organization.id, period),
    getCompanyReport(role.organization.id, period),
    getEntrySourceReport(role.organization.id, period),
  ]);

  // achievement と roi は kpi の後で計算(depends on kpiCurrent)
  const [achievement, roi] = await Promise.all([
    getAchievementForPeriod(role.organization.id, period, kpiCurrent),
    isAdmin ? getRoiSummary(role.organization.id, period) : Promise.resolve(null),
  ]);

  const showExport = canExport(role);

  return (
    <div className="mx-auto flex max-w-6xl gap-6 md:gap-8">
      <SectionNav />

      <div className="print-single-column flex-1 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">レポート</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {role.organization.name} の活動状況をまとめます
            </p>
          </div>
          {/* 右上ツールバー:1 行にコンパクト集約。 CSV はドロップダウンにまとめる。 */}
          <div className="no-print flex flex-wrap items-center justify-end gap-2">
            {isAdmin && (
              <Link
                href="/agency/reports/settings"
                className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
              >
                目標 / コスト設定
              </Link>
            )}
            <PrintButton />
            {showExport && <ExportMenu />}
          </div>
        </div>

        <div className="no-print">
          <PeriodFilter period={period} />
        </div>

        {/* 1. KPI ヘッドライン */}
        <section id="kpi" className="scroll-mt-4 space-y-2">
          <KpiHeadline current={kpiCurrent} previous={kpiPrevious} />
          <p className="text-muted-foreground text-[10px]">
            前期比の基準:{previousPeriod.from} 〜 {previousPeriod.to}
          </p>
        </section>

        {/* 2. 目標達成率 */}
        <section id="achievement" className="scroll-mt-4">
          <AchievementSection rows={achievement} isAdmin={isAdmin} />
        </section>

        {/* 3. ROI(admin 限定) */}
        {isAdmin && roi && (
          <section id="roi" className="scroll-mt-4">
            <RoiSection data={roi} isAdmin={isAdmin} />
          </section>
        )}

        {/* 4. 時系列トレンド */}
        <section id="trend" className="scroll-mt-4">
          <TrendSection data={trend} />
        </section>

        {/* 5. 成約・売上 */}
        <section id="monthly-deals" className="scroll-mt-4">
          <MonthlyDealsSection data={monthlyDeals} />
        </section>

        {/* 6. 成約率 */}
        <section id="placement-rate" className="scroll-mt-4">
          <PlacementRateSection data={placementRate} />
        </section>

        {/* 7. 選考ファネル */}
        <section id="funnel" className="scroll-mt-4">
          <SelectionFunnelSection application={funnelByApplication} candidate={funnelByCandidate} />
        </section>

        {/* 8. 企業別 */}
        <section id="company" className="scroll-mt-4">
          <CompanyReportSection rows={companyReport} />
        </section>

        {/* 9. エントリーサイト別 */}
        <section id="entry-source" className="scroll-mt-4">
          <EntrySourceSection rows={entrySourceReport} />
        </section>

        {/* 10. アドバイザー別 */}
        <section id="advisor" className="scroll-mt-4">
          <AdvisorPerformanceSection data={advisor} />
        </section>

        {/* 11. 所要日数 */}
        <section id="phase-duration" className="scroll-mt-4">
          <PhaseDurationSection data={phaseDuration} />
        </section>

        {/* 12. ステータス分布 */}
        <section id="status-distribution" className="scroll-mt-4">
          <StatusDistributionSection clients={clients} referrals={referrals} />
        </section>
      </div>
    </div>
  );
}

function normalizePeriodPreset(raw: string | undefined): PeriodPreset {
  if (raw === "last-month" || raw === "custom") return raw;
  return "this-month";
}

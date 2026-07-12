import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import {
  computePreviousPeriod,
  getAdvisorPerformance,
  getClientStatusDistribution,
  getKpiSummary,
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
import { KpiHeadline } from "./kpi-headline";
import { SectionNav } from "./section-nav";
import { StatusDistributionSection } from "./status-distribution-section";
import { MonthlyDealsSection } from "./monthly-deals-section";
import { PlacementRateSection } from "./placement-rate-section";
import { SelectionFunnelSection } from "./selection-funnel-section";
import { AdvisorPerformanceSection } from "./advisor-performance-section";
import { PhaseDurationSection } from "./phase-duration-section";

/**
 * エージェント向けレポート画面(改善版:KPI ヘッドライン + セクションナビ)
 *
 * レイアウト:
 *   ・上部に KPI ヘッドライン(成約数 / 純売上 / 応募 / 面談 + 前期比)
 *   ・md 以上でサイドバーに sticky セクションナビ
 *   ・本体は Card 単位で縦に並べる
 *
 * データ取得:
 *   ・当期と前期の KpiSummary を並列取得
 *   ・その他の詳細セクションは当期のみで足りるので既存クエリを再利用
 *
 * 期間フィルタは URL searchParams で持ち、Period に解決してから使う。
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

  // C(アドバイザー別)はサーバー側で権限フィルタを掛ける。
  // advisor の場合、自分のデータしか取得しない。
  const viewer = {
    memberId: role.member.id,
    userId: user.id,
    isAdmin: role.member.role === "admin",
  };

  // 全部並列取得。 KPI サマリは当期/前期の 2 呼び出しを含む。
  const [
    kpiCurrent,
    kpiPrevious,
    clients,
    referrals,
    monthlyDeals,
    placementRate,
    funnelByApplication,
    funnelByCandidate,
    advisor,
    phaseDuration,
  ] = await Promise.all([
    getKpiSummary(role.organization.id, period),
    getKpiSummary(role.organization.id, previousPeriod),
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
    <div className="mx-auto flex max-w-6xl gap-6 md:gap-8">
      <SectionNav />

      <div className="flex-1 space-y-6">
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
              <ExportButton href="/api/agency/export/interviews" label="面接 履歴 CSV" />
              <ExportButton href="/api/agency/export/tasks" label="タスク CSV" />
              <ExportButton href="/api/agency/export/line-broadcasts" label="LINE 一斉配信 CSV" />
            </div>
          )}
        </div>

        <PeriodFilter period={period} />

        {/* KPI ヘッドライン(前期比付き)*/}
        <section id="kpi" className="scroll-mt-4 space-y-2">
          <KpiHeadline current={kpiCurrent} previous={kpiPrevious} />
          <p className="text-muted-foreground text-[10px]">
            前期比の基準:{previousPeriod.from} 〜 {previousPeriod.to}
          </p>
        </section>

        {/* セクションアンカーを付けて sticky nav から飛べるようにする */}
        <section id="monthly-deals" className="scroll-mt-4">
          <MonthlyDealsSection data={monthlyDeals} />
        </section>

        <section id="placement-rate" className="scroll-mt-4">
          <PlacementRateSection data={placementRate} />
        </section>

        <section id="funnel" className="scroll-mt-4">
          <SelectionFunnelSection application={funnelByApplication} candidate={funnelByCandidate} />
        </section>

        <section id="advisor" className="scroll-mt-4">
          <AdvisorPerformanceSection data={advisor} />
        </section>

        <section id="phase-duration" className="scroll-mt-4">
          <PhaseDurationSection data={phaseDuration} />
        </section>

        <section id="status-distribution" className="scroll-mt-4">
          <StatusDistributionSection clients={clients} referrals={referrals} />
        </section>
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

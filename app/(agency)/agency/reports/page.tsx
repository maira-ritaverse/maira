import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/organizations/queries";
import { canExport } from "@/lib/permissions/server";
import { getCurrentOrganizationPlan } from "@/lib/billing/agency";
import { getPlanEntitlements } from "@/lib/billing/plan-entitlements";
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
  getOfferAcceptanceRate,
  getPhaseDuration,
  getPlacementRate,
  getReferralStatusDistribution,
  getRoiSummary,
  getSelectionFunnel,
  getSelectionFunnelByCandidate,
  getTimeToFill,
  resolvePeriod,
  type PeriodPreset,
} from "@/lib/reports/queries";
import { AchievementSection } from "./achievement-section";
import { AdvisorPerformanceSection } from "./advisor-performance-section";
import { BenchmarksSection } from "./benchmarks-section";
import { CompanyReportSection } from "./company-report-section";
import { CustomizePanel, type SectionMeta } from "./customize-panel";
import { EntrySourceSection } from "./entry-source-section";
import { ExportMenu } from "./export-menu";
import { KpiHeadline } from "./kpi-headline";
import { MemberSelector, type ReportMemberOption } from "./member-selector";
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
 * エージェント向けレポート画面。
 *
 * ・SECTION_CATALOG が「使えるセクションの単一の真実」
 * ・ユーザーの表示設定(report_preferences)で並び順・非表示を反映
 * ・admin 限定セクション(ROI 等)は非 admin には最初から除外
 * ・SectionNav / CustomizePanel も同じカタログを共有する
 * ・PrintButton で印刷 / PDF 出力(サイドバーは非表示化)
 */
type SearchParams = Promise<{
  period?: string;
  from?: string;
  to?: string;
  /** admin 専用 の 「対象 メンバー」 フィルタ (uuid)。 未指定 = 組織全体 */
  member?: string;
}>;

/**
 * セクションカタログ(表示順のデフォルト = この配列の並び)。
 *
 * ・id はスクロールアンカーと preferences 保存キーを兼ねる。 追加・削除するときは
 *   互換のため既存 id を変えない(消しても preferences 側は自然に無視される)。
 * ・restrictTo は権限で除外するセクションのマーカー。
 *   admin のみが見るべきセクションで指定する(現状は roi のみ)。
 */
const SECTION_CATALOG: SectionMeta[] = [
  { id: "kpi", label: "サマリー" },
  { id: "benchmarks", label: "業界ベンチマーク" },
  { id: "achievement", label: "目標達成率" },
  { id: "roi", label: "ROI(admin)", restrictTo: "admin" },
  { id: "trend", label: "時系列トレンド" },
  { id: "monthly-deals", label: "成約・売上" },
  { id: "placement-rate", label: "成約率" },
  { id: "funnel", label: "選考ファネル" },
  { id: "company", label: "企業別" },
  { id: "entry-source", label: "エントリーサイト別" },
  { id: "advisor", label: "アドバイザー別" },
  { id: "phase-duration", label: "所要日数" },
  { id: "status-distribution", label: "ステータス分布" },
];

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

  // プラン tier 別 の レポート 機能 開放。
  // ・canUseAdvancedReports = false (Solo / Solo Pro) → アドバイザー別 絞込 セレクター を 非表示
  //   (1 席 プラン で は 「対象 メンバー」 という 概念 が そもそも 意味 を なさない)
  const plan = await getCurrentOrganizationPlan(supabase);
  const entitlements = getPlanEntitlements(plan?.tier ?? "standard");

  const viewer = {
    memberId: role.member.id,
    userId: user.id,
    isAdmin,
  };

  // ── メンバー フィルタ の 解決 (admin のみ、 かつ 上位 プラン のみ)
  //   ・selector の 選択肢 と 「?member= が 自組織 メンバー か」 の 検証 を 兼ねる
  //   ・非 admin (advisor) は 既に viewer 経由 で 自分 の データ しか 見え ない ため、
  //     この セレクター は 出さ ない & 受け取った ?member パラメータ も 無視 する
  //   ・Solo / Solo Pro は 1 席 固定 な ので 呼ぶ 意味 が なく、 memberOptions を 空 に する
  //     (下 の 描画 分岐 で 自動 的 に 非表示)
  const memberOptions: ReportMemberOption[] =
    isAdmin && entitlements.canUseAdvancedReports
      ? await fetchMemberOptions(supabase, role.organization.id)
      : [];
  const memberIdSet = new Set(memberOptions.map((m) => m.memberId));
  const selectedMemberId =
    isAdmin && params.member && memberIdSet.has(params.member) ? params.member : null;
  const selectedMemberName = selectedMemberId
    ? (memberOptions.find((m) => m.memberId === selectedMemberId)?.displayName ?? null)
    : null;

  // データ + カスタマイズ設定を並列で取得。 selectedMemberId が null の 場合 は
  // 従来 通り 組織 全体 集計 (undefined 相当 の 挙動)。
  const memberFilter = selectedMemberId ?? undefined;
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
    timeToFill,
    offerAcceptance,
    preferences,
  ] = await Promise.all([
    getKpiSummary(role.organization.id, period, memberFilter),
    getKpiSummary(role.organization.id, previousPeriod, memberFilter),
    getMonthlyTrend(role.organization.id, undefined, memberFilter),
    getClientStatusDistribution(role.organization.id, memberFilter),
    getReferralStatusDistribution(role.organization.id, memberFilter),
    getMonthlyDealsRevenue(role.organization.id, period, memberFilter),
    getPlacementRate(role.organization.id, period, memberFilter),
    getSelectionFunnel(role.organization.id, period, memberFilter),
    getSelectionFunnelByCandidate(role.organization.id, period, memberFilter),
    getAdvisorPerformance(role.organization.id, viewer, period, memberFilter),
    getPhaseDuration(role.organization.id, period, memberFilter),
    getCompanyReport(role.organization.id, period, memberFilter),
    getEntrySourceReport(role.organization.id, period, memberFilter),
    getTimeToFill(role.organization.id, period, memberFilter),
    getOfferAcceptanceRate(role.organization.id, period, memberFilter),
    fetchPreferences(role.organization.id, user.id),
  ]);

  // 目標達成率 は 組織 全体 目標 なので、 メンバー 指定時 は null (非表示)。
  // ROI は コスト が 組織 全体 で 分解 不能 なので 同 じく null (非表示)。
  const [achievement, roi] = await Promise.all([
    getAchievementForPeriod(role.organization.id, period, kpiCurrent, memberFilter),
    isAdmin ? getRoiSummary(role.organization.id, period, memberFilter) : Promise.resolve(null),
  ]);

  // Cost per Hire は admin かつコスト入力があるときのみ
  const costPerHireData =
    isAdmin && roi && roi.totalCost > 0
      ? {
          totalCost: roi.totalCost,
          placementCount: kpiCurrent.placementCount,
          costPerHire:
            kpiCurrent.placementCount > 0 ? roi.totalCost / kpiCurrent.placementCount : null,
          benchmarkYen: 180_000,
        }
      : null;

  // レポート の CSV エクスポート は canExport 権限 + プラン tier の canUseCsvExport の 両方 必要。
  const showExport = canExport(role) && entitlements.canUseCsvExport;

  // ID → 描画中身の Map。 セクションが増えたら ここに 1 行追加するだけで OK。
  // null を 返す と セクション 自体 を 出さ ない (下記 visibleSections フィルタ)。
  const renderers: Record<string, ReactNode> = {
    kpi: (
      <div className="space-y-2">
        <KpiHeadline current={kpiCurrent} previous={kpiPrevious} />
        <p className="text-muted-foreground text-[10px]">
          前期比の基準:{previousPeriod.from} 〜 {previousPeriod.to}
        </p>
      </div>
    ),
    benchmarks: (
      <BenchmarksSection
        timeToFill={timeToFill}
        offerAcceptance={offerAcceptance}
        costPerHire={costPerHireData}
      />
    ),
    // メンバー 指定時 は 目標 達成率 (組織 全体 の 目標) は 表示 しない
    achievement: selectedMemberId ? null : (
      <AchievementSection rows={achievement} isAdmin={isAdmin} />
    ),
    // メンバー 指定時 は ROI (組織 全体 の コスト) は 表示 しない
    roi: isAdmin && roi && !selectedMemberId ? <RoiSection data={roi} isAdmin={isAdmin} /> : null,
    trend: <TrendSection data={trend} />,
    "monthly-deals": <MonthlyDealsSection data={monthlyDeals} />,
    "placement-rate": <PlacementRateSection data={placementRate} />,
    funnel: (
      <SelectionFunnelSection application={funnelByApplication} candidate={funnelByCandidate} />
    ),
    company: <CompanyReportSection rows={companyReport} />,
    "entry-source": <EntrySourceSection rows={entrySourceReport} />,
    advisor: <AdvisorPerformanceSection data={advisor} />,
    "phase-duration": <PhaseDurationSection data={phaseDuration} />,
    "status-distribution": <StatusDistributionSection clients={clients} referrals={referrals} />,
  };

  // 設定を適用した最終的な描画順(hidden 除外・権限フィルタ・カタログに無い ID は捨てる)
  const finalOrder = resolveOrder(SECTION_CATALOG, preferences.section_order, isAdmin);
  const hiddenSet = new Set(preferences.hidden_sections);
  const visibleSections = finalOrder
    .filter((id) => !hiddenSet.has(id))
    .map((id) => SECTION_CATALOG.find((s) => s.id === id))
    .filter((s): s is SectionMeta => Boolean(s));

  return (
    <div className="mx-auto flex max-w-6xl gap-6 md:gap-8">
      <SectionNav sections={visibleSections} />

      <div className="print-single-column flex-1 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">レポート</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {role.organization.name} の活動状況をまとめます
              {selectedMemberName && (
                <>
                  {" ・ "}
                  <span className="text-foreground font-medium">対象: {selectedMemberName}</span>
                </>
              )}
            </p>
          </div>
          <div className="no-print flex flex-wrap items-center justify-end gap-2">
            {isAdmin && (
              <Link
                href="/agency/reports/settings"
                className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
              >
                目標 / コスト設定
              </Link>
            )}
            <CustomizePanel
              allSections={SECTION_CATALOG}
              initialOrder={preferences.section_order}
              initialHidden={preferences.hidden_sections}
              isAdmin={isAdmin}
            />
            <PrintButton />
            {showExport && <ExportMenu />}
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-4">
          <PeriodFilter period={period} />
          {isAdmin && memberOptions.length > 0 && (
            <MemberSelector members={memberOptions} currentMemberId={selectedMemberId} />
          )}
        </div>

        {visibleSections.map((section) => {
          const content = renderers[section.id];
          if (!content) return null;
          return (
            <section key={section.id} id={section.id} className="scroll-mt-4">
              {content}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function normalizePeriodPreset(raw: string | undefined): PeriodPreset {
  if (raw === "last-month" || raw === "custom") return raw;
  return "this-month";
}

/**
 * 保存済み設定を取得。 未保存(初回)なら空配列を返す。
 *
 * page.tsx でしか使わない小さなクエリなので lib に切り出さずインラインで持つ。
 * organization_id と user_id を必ず絞ることで RLS と多層防御になる。
 */
async function fetchPreferences(
  organizationId: string,
  userId: string,
): Promise<{ section_order: string[]; hidden_sections: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_preferences")
    .select("section_order, hidden_sections")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  type Row = { section_order: unknown; hidden_sections: unknown };
  const row = data as Row | null;
  return {
    section_order: asStringArray(row?.section_order),
    hidden_sections: asStringArray(row?.hidden_sections),
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * MemberSelector 用 の 組織 メンバー 一覧 を 取得。
 *
 * SECURITY DEFINER RPC (list_organization_member_display_names) 経由 で、
 * profiles の RLS を 緩めず に (member_id, display_name) だけ を 公開 する。
 * 呼出 側 は admin 判定 済み だが、 RPC 自体 も 呼出 user が 対象 organization
 * の member か どうか を チェック する ので 多層 防御。
 *
 * display_name が null の メンバー (プロフィール 未設定) は 「(名前未設定)」 と
 * selector 側 で 表示 する ので ここ で は 落とさ ない。
 */
type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

async function fetchMemberOptions(
  supabase: SupabaseServer,
  organizationId: string,
): Promise<ReportMemberOption[]> {
  const { data, error } = await supabase.rpc("list_organization_member_display_names", {
    target_organization_id: organizationId,
  });
  if (error || !data) return [];
  const rows = data as Array<{ member_id: string; display_name: string | null }>;
  return rows
    .map((r) => ({
      memberId: r.member_id,
      displayName: r.display_name ?? "",
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
}

/**
 * 保存済み並び順 + カタログ + 権限を組み合わせて、最終的な描画順を返す。
 *
 * ・保存にあってカタログに無い ID(セクションが消された)は除外
 * ・カタログにあって保存に無い ID(セクションが増えた)は末尾に追加
 *   (ユーザーが後から気付いて並び替えできるように、消さずに残す)
 * ・権限外のセクション(admin 限定を非 admin が保持している等)は除外
 */
function resolveOrder(catalog: SectionMeta[], stored: string[], isAdmin: boolean): string[] {
  const permitted = catalog.filter((s) => !s.restrictTo || (s.restrictTo === "admin" && isAdmin));
  const permittedIds = new Set(permitted.map((s) => s.id));
  const kept = stored.filter((id) => permittedIds.has(id));
  const missing = permitted.filter((s) => !stored.includes(s.id)).map((s) => s.id);
  return [...kept, ...missing];
}

import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { SettingsBackLink } from "@/components/features/settings/settings-back-link";
import {
  AI_KIND_LABEL,
  getOrgAiTotalQuotaSummary,
  getOrgAiUsageSummary,
  getOrgAiUsageTrend,
} from "@/lib/agency/ai-usage-queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * /agency/settings/ai-usage
 *
 * 組織管理者向け:今月の AI 利用状況をメンバー × kind 別に表示。
 * admin 以外は agency トップにリダイレクト。
 */
export default async function AgencyAiUsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(user.id);
  if (
    role.accountType !== "organization_member" ||
    !role.organization ||
    !role.member ||
    role.member.role !== "admin"
  ) {
    redirect("/agency");
  }

  let summary;
  let trend;
  let totalQuota;
  try {
    [summary, trend, totalQuota] = await Promise.all([
      getOrgAiUsageSummary(),
      getOrgAiUsageTrend(6),
      getOrgAiTotalQuotaSummary(),
    ]);
  } catch (err) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-bold">AI 利用状況</h1>
        <Card className="border-red-200 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {err instanceof Error ? err.message : "読込に失敗しました"}
        </Card>
      </div>
    );
  }

  const trendMax = trend.length > 0 ? Math.max(...trend.map((t) => t.total), 1) : 1;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <SettingsBackLink href="/agency/settings" />
      <div>
        <h1 className="mt-1 text-2xl font-bold">AI 利用状況</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          今月({new Date(summary.monthStart).toLocaleDateString("ja-JP")} 以降)の組織内 AI
          利用件数。
        </p>
      </div>

      {/* 月次総量 残数 (運営側 設定の 強制上限) */}
      <Card className="space-y-2 border-amber-200 bg-amber-50/40 p-5 dark:border-amber-900 dark:bg-amber-950/30">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-amber-900 dark:text-amber-100">
            今月の 残り AI 利用回数
          </h2>
          <span className="text-[10px] text-amber-900/70">上限は 運営側で 管理(変更不可)</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-amber-900 dark:text-amber-50">
            {totalQuota.remaining.toLocaleString()}
          </span>
          <span className="text-sm text-amber-900/70">
            回 / 月次上限 {totalQuota.limit.toLocaleString()} 回 (使用済み{" "}
            {totalQuota.current.toLocaleString()} 回)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100 dark:bg-amber-950">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{
              width: `${totalQuota.limit > 0 ? Math.min(100, (totalQuota.current / totalQuota.limit) * 100) : 0}%`,
            }}
          />
        </div>
        <p className="text-[11px] text-amber-900/70">
          エージェント職員の 利用 合計 で カウント (求職者の AI 利用は 別計算)。 上限に 達すると 全
          AI 機能が 一時停止します。
        </p>
      </Card>

      {/* 組織横断サマリ */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">組織合計</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(AI_KIND_LABEL).map(([k, label]) => {
            const count = summary.byKindTotal[k] ?? 0;
            return (
              <div key={k} className="space-y-0.5">
                <p className="text-muted-foreground text-[11px]">{label}</p>
                <p className="text-2xl font-bold">{count.toLocaleString()}</p>
                <p className="text-muted-foreground text-[10px]">回</p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-2">
          <span className="text-xs">合計</span>
          <span className="text-base font-medium">{summary.grandTotal.toLocaleString()} 回</span>
        </div>
      </Card>

      {/* 月次推移(過去 6 か月) */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">月次推移(過去 6 か月)</h2>
        <p className="text-muted-foreground text-xs">
          縦バー = 当月の総 AI 利用回数。今月は進行中の値です。
        </p>
        <div className="flex h-32 items-end gap-1.5">
          {trend.map((t) => {
            const heightPct = Math.round((t.total / trendMax) * 100);
            return (
              <div key={t.monthStart} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="bg-muted relative w-full overflow-hidden rounded-t"
                  style={{ height: "100%" }}
                  aria-label={`${t.monthLabel}: ${t.total} 回`}
                >
                  <div
                    className="absolute bottom-0 left-0 w-full bg-emerald-500 transition-all dark:bg-emerald-600"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-medium">{t.total}</p>
                  <p className="text-muted-foreground text-[9px]">{t.monthLabel}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-muted-foreground flex justify-between text-[10px]">
          <span>合計(6 か月):{trend.reduce((s, t) => s + t.total, 0).toLocaleString()} 回</span>
        </div>
      </Card>

      {/* メンバー別 */}
      <Card className="space-y-2 p-5">
        <h2 className="text-base font-semibold">メンバー別の内訳</h2>
        {summary.members.length === 0 ? (
          <p className="text-muted-foreground text-xs">メンバーがいません。</p>
        ) : (
          <ul className="divide-foreground/10 divide-y">
            {summary.members.map((m) => {
              return (
                <li key={m.userId} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{m.displayName}</p>
                      <p className="text-muted-foreground text-[11px]">{m.email}</p>
                    </div>
                    <p className="text-sm font-medium">{m.total.toLocaleString()} 回</p>
                  </div>
                  {m.total > 0 && (
                    <div className="text-muted-foreground flex flex-wrap gap-x-3 text-[11px]">
                      {Object.entries(AI_KIND_LABEL).map(([k, label]) => {
                        const c = m.byKind[k] ?? 0;
                        if (c === 0) return null;
                        return (
                          <span key={k}>
                            {label}: <strong>{c}</strong>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

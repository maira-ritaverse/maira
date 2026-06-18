import Link from "next/link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import {
  AI_KIND_LABEL,
  estimateCostUsd,
  getOrgAiUsageSummary,
  getOrgAiUsageTrend,
  getOrganizationAiQuotas,
} from "@/lib/agency/ai-usage-queries";
import { getUserRole } from "@/lib/organizations/queries";
import { createClient } from "@/lib/supabase/server";

import { AiQuotasForm } from "./ai-quotas-form";

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
  let quotas;
  try {
    [summary, trend, quotas] = await Promise.all([
      getOrgAiUsageSummary(),
      getOrgAiUsageTrend(6),
      getOrganizationAiQuotas(),
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

  const grandCost = estimateCostUsd(summary.byKindTotal);
  const trendMax = trend.length > 0 ? Math.max(...trend.map((t) => t.total), 1) : 1;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/agency/settings" className="hover:underline">
            ← 設定
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold">AI 利用状況</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          今月({new Date(summary.monthStart).toLocaleDateString("ja-JP")} 以降)の組織内 AI
          利用件数。 コストは概算値で、実請求は Anthropic / OpenAI の月次明細をご確認ください。
        </p>
      </div>

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
          <span className="text-base font-medium">
            {summary.grandTotal.toLocaleString()} 回 / 約 ${grandCost.toFixed(2)} USD
          </span>
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
          <span>概算コスト合計:約 ${trend.reduce((s, t) => s + t.costUsd, 0).toFixed(2)} USD</span>
        </div>
      </Card>

      {/* 管理者専用:AI 月次上限の編集 */}
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-base font-semibold">月次上限の設定(管理者専用)</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            各 AI 機能の月次利用上限を設定します。空欄=既定値、0=完全停止。 連携している求職者の AI
            上限もここで管理できます。
          </p>
        </div>
        <AiQuotasForm initial={quotas} />
      </Card>

      {/* メンバー別 */}
      <Card className="space-y-2 p-5">
        <h2 className="text-base font-semibold">メンバー別の内訳</h2>
        {summary.members.length === 0 ? (
          <p className="text-muted-foreground text-xs">メンバーがいません。</p>
        ) : (
          <ul className="divide-foreground/10 divide-y">
            {summary.members.map((m) => {
              const cost = estimateCostUsd(m.byKind);
              return (
                <li key={m.userId} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{m.displayName}</p>
                      <p className="text-muted-foreground text-[11px]">{m.email}</p>
                    </div>
                    <p className="text-sm font-medium">
                      {m.total.toLocaleString()} 回
                      {cost > 0 && (
                        <span className="text-muted-foreground ml-1 text-[11px]">
                          (約 ${cost.toFixed(2)})
                        </span>
                      )}
                    </p>
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

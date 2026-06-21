"use client";

import { Calendar, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { KpiPeriod, LineMaKpi } from "@/lib/ma/line-kpi";
import type { ScenarioSendStatsMap } from "@/lib/ma/kpi";
import {
  isScenarioImplemented,
  type ConsentStatus,
  type MAFeature,
  type ScenarioView,
} from "@/lib/ma/types";

import { ConsentModal } from "./consent-modal";
import { TestSendModal } from "./test-send-modal";

/**
 * LINE (MA) 画面 (EMPRO 風 レイアウト)
 *
 * 構成:
 *   ・ヘッダー:タイトル + 同意 状態 + 送信ログ / 配信設定 ボタン
 *   ・LINE 配信 数 進捗 バー (0 / 5,000)
 *   ・KPI じょうご:配信数 → クリック / 返信 → 応募
 *   ・求職者 シナリオ カード (channel='line' のみ)
 *
 * KPI の 「クリック」「応募」 は 計測 未実装 の ため null = 「準備中」 表示。
 * 「配信数」「返信」 は 今月 の 実数 を 表示。
 */
export type LineMaScreenProps = {
  scenarios: ScenarioView[];
  consent: ConsentStatus;
  consentVersion: string;
  isAdmin: boolean;
  sendStatsByScenarioId: ScenarioSendStatsMap;
  lastSentAtByScenarioId: Record<string, string>;
  kpi: LineMaKpi;
  period: KpiPeriod;
};

export function LineMaScreen({
  scenarios,
  consent,
  consentVersion,
  isAdmin,
  sendStatsByScenarioId,
  lastSentAtByScenarioId,
  kpi,
  period,
}: LineMaScreenProps) {
  const router = useRouter();
  const [showConsent, setShowConsent] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // LINE channel の 求職者 向け シナリオ
  const candidateScenarios = scenarios.filter(
    (s) => s.preset.audience === "candidate" && s.preset.channel === "line",
  );

  const usagePct = kpi.limit > 0 ? Math.min(100, Math.round((kpi.sentCount / kpi.limit) * 100)) : 0;

  async function handleRevoke() {
    if (!window.confirm("LINE MA 機能 の 利用 を 停止 します。 よろしい です か?")) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch("/api/agency/ma/consent", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: "line_ma" satisfies MAFeature }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "撤回 に 失敗 しました");
      }
      router.refresh();
    } catch (e) {
      setRevokeError(e instanceof Error ? e.message : "不明 な エラー");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ヘッダー (タイトル 左 / 同意 状態 右) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">LINE (MA)</h1>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              β版
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            LINE 自動配信 シナリオ の 管理・設定
          </p>
        </div>
        <div className="text-right">
          {consent.isActive ? (
            <>
              <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
                <Check className="size-3" aria-hidden />
                {consent.acceptedAt
                  ? new Date(consent.acceptedAt).toLocaleDateString("ja-JP")
                  : "—"}{" "}
                {consent.acceptedByMemberName ?? ""} 様 により 有効化 (特約 v
                {consent.consentVersion})
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void handleRevoke()}
                  disabled={revoking}
                  className="mt-0.5 text-xs text-emerald-700 hover:underline disabled:opacity-50"
                >
                  {revoking ? "撤回中..." : "利用条件 を 再確認 / 撤回"}
                </button>
              )}
            </>
          ) : (
            <Button
              size="sm"
              disabled={!isAdmin}
              onClick={() => setShowConsent(true)}
              className="bg-emerald-500 text-white hover:bg-emerald-600"
            >
              有効化 する
            </Button>
          )}
          {revokeError && (
            <p className="mt-1 rounded border border-red-200 bg-red-50 p-1 text-[10px] text-red-800">
              {revokeError}
            </p>
          )}
        </div>
      </div>

      {/* 期間 + アクション バー */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* 期間 セレクト (今月 / 先月) */}
          <div className="inline-flex rounded-md ring-1 ring-slate-200">
            <Link
              href="/agency/marketing"
              className={`rounded-l-md px-3 py-1 text-xs font-medium ${
                period === "current"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              今月
            </Link>
            <Link
              href="/agency/marketing?period=prev"
              className={`rounded-r-md px-3 py-1 text-xs font-medium ${
                period === "prev"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              先月
            </Link>
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs">
            <Calendar className="size-3 text-slate-500" aria-hidden />
            <span>{kpi.periodLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/agency/marketing/logs" />}>
            送信ログ
          </Button>
          <Button
            size="sm"
            className="bg-emerald-500 text-white hover:bg-emerald-600"
            render={<Link href="/agency/line/settings" />}
          >
            ⚙ 配信設定
          </Button>
        </div>
      </div>

      {/* LINE 配信 数 進捗 バー */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold">
            LINE 配信数
            {kpi.plan && (
              <span className="text-muted-foreground ml-1 text-[10px]">
                (
                {kpi.plan === "free"
                  ? "Communication"
                  : kpi.plan === "light"
                    ? "Light"
                    : kpi.plan === "standard"
                      ? "Standard"
                      : kpi.plan}{" "}
                プラン)
              </span>
            )}
          </span>
          <span className="text-slate-700">
            <span className="text-base font-bold">{kpi.sentCount.toLocaleString()}</span>
            <span className="text-muted-foreground"> / {kpi.limit.toLocaleString()}</span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${
              usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-emerald-500"
            }`}
            style={{ width: `${usagePct}%` }}
          />
        </div>
      </div>

      {/* KPI じょうご */}
      <div className="grid grid-cols-2 gap-2 rounded-md border bg-slate-50/40 p-3 md:grid-cols-4">
        <KpiCell label="配信数" value={kpi.sentCount} tone="primary" />
        <KpiCell
          label="クリック"
          value={kpi.clickCount}
          tone="muted"
          rate={kpi.sentCount > 0 ? kpi.clickCount / kpi.sentCount : null}
        />
        <KpiCell
          label="返信"
          value={kpi.replyCount}
          tone="muted"
          rate={kpi.sentCount > 0 ? kpi.replyCount / kpi.sentCount : null}
        />
        <KpiCell
          label="応募"
          value={kpi.applicationCount}
          tone="strong"
          hint="配信 後 7 日 以内 に referrals 作成 さ れた 一意 客 数"
          rate={kpi.sentCount > 0 ? kpi.applicationCount / kpi.sentCount : null}
        />
      </div>

      {/* シナリオ カード */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">求職者 シナリオ ({candidateScenarios.length})</h2>
          <span className="text-muted-foreground text-[10px]">LINE 配信 は 求職者 向け のみ</span>
        </div>
        {candidateScenarios.length === 0 ? (
          <Card className="text-muted-foreground p-4 text-sm">
            LINE 配信 用 の シナリオ プリセット が 投入 されて いません。
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {candidateScenarios.map((view, idx) => (
              <LineScenarioCard
                key={view.preset.id}
                index={idx + 1}
                view={view}
                disabled={!consent.isActive || !isAdmin}
                stats={view.activation ? sendStatsByScenarioId[view.activation.id] : undefined}
                lastSentAt={
                  view.activation ? lastSentAtByScenarioId[view.activation.id] : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <ConsentModal
        open={showConsent}
        feature="line_ma"
        consentVersion={consentVersion}
        onClose={() => setShowConsent(false)}
      />
    </div>
  );
}

// ============================================================
// KPI セル
// ============================================================
function KpiCell({
  label,
  value,
  tone,
  hint,
  rate,
}: {
  label: string;
  value: number | null;
  tone: "primary" | "strong" | "muted";
  hint?: string;
  /** 配信数 比 率 (0..1)。 null なら 表示 しない */
  rate?: number | null;
}) {
  const cls =
    tone === "primary"
      ? "text-emerald-700"
      : tone === "strong"
        ? "text-emerald-800"
        : "text-slate-700";
  const ratePct = rate === null || rate === undefined ? null : Math.round(rate * 1000) / 10;
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground flex items-center gap-1 text-[10px]">
        {label}
        {hint && (
          <span className="text-slate-400" title={hint}>
            ⓘ
          </span>
        )}
      </p>
      <p className={`text-lg font-bold ${cls}`}>
        {value === null ? <span className="text-muted-foreground text-sm">準備中</span> : value}
        {value !== null && ratePct !== null && (
          <span className="text-muted-foreground ml-1 text-[10px]">({ratePct}%)</span>
        )}
      </p>
    </div>
  );
}

// ============================================================
// LINE シナリオ カード
// ============================================================
function LineScenarioCard({
  index,
  view,
  disabled,
  stats,
  lastSentAt,
}: {
  index: number;
  view: ScenarioView;
  disabled: boolean;
  stats?: { sent: number; failed: number; skipped: number };
  lastSentAt?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showTestSend, setShowTestSend] = useState(false);

  const isActive = view.activation?.isActive ?? false;
  const days = view.effectiveTriggerDays;
  const daysLabel = days < 0 ? `${Math.abs(days)}日前` : `${days}日後`;
  const implemented = isScenarioImplemented(view.preset.key);
  const cardDisabled = disabled || !implemented;

  function handleToggle() {
    if (cardDisabled) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch("/api/agency/ma/scenarios", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presetId: view.preset.id, isActive: !isActive }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(data?.message ?? "更新 に 失敗 しました");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明 な エラー");
      }
    });
  }

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{view.preset.name}</h3>
        {!implemented && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            準備中
          </span>
        )}
      </div>

      <div className="text-muted-foreground text-xs">
        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
          起点: {view.preset.triggerEvent} → {daysLabel}
        </span>
      </div>

      <p className="text-muted-foreground text-xs">{view.preset.description}</p>

      {stats && (
        <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
          <span>直近30日:</span>
          <span className="font-mono">
            <span className="text-emerald-700">成功 {stats.sent}</span>
            {" / "}
            <span className="text-red-700">失敗 {stats.failed}</span>
            {" / "}
            <span className="text-slate-500">スキップ {stats.skipped}</span>
          </span>
        </div>
      )}
      {view.activation && (
        <div className="text-muted-foreground text-[10px]">
          最終配信:{" "}
          {lastSentAt
            ? new Date(lastSentAt).toLocaleDateString("ja-JP", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })
            : "未配信"}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex items-center gap-1">
          {/* LINE アイコン 風 緑 丸 */}
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#06C755] text-[9px] font-bold text-white">
            L
          </span>
          <span className="text-muted-foreground text-xs">シナリオ{index}</span>
        </div>
        <div className="flex items-center gap-2">
          {view.activation && implemented && (
            <>
              <Link
                href={`/agency/marketing/${encodeURIComponent(view.activation.id)}/template`}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                ✎ テンプレート編集
              </Link>
              <button
                type="button"
                onClick={() => setShowTestSend(true)}
                disabled={disabled}
                className="text-muted-foreground text-xs hover:underline disabled:opacity-50"
              >
                テスト送信
              </button>
            </>
          )}
          {/* ON/OFF トグル */}
          <button
            type="button"
            onClick={handleToggle}
            disabled={cardDisabled || pending}
            className="flex items-center gap-1.5 text-xs disabled:opacity-50"
            aria-label={isActive ? "停止" : "配信開始"}
          >
            <span className={isActive ? "text-emerald-700" : "text-muted-foreground"}>
              {isActive ? "配信中" : "停止中"}
            </span>
            <span
              className={`relative inline-block h-4 w-7 rounded-full transition-colors ${
                isActive ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  isActive ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>
        </div>
      </div>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-1 text-[10px] text-red-800">
          {error}
        </p>
      )}

      {view.activation && (
        <TestSendModal
          open={showTestSend}
          scenarioId={view.activation.id}
          scenarioName={view.preset.name}
          onClose={() => setShowTestSend(false)}
        />
      )}
    </Card>
  );
}

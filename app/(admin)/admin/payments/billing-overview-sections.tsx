"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 課金 / 売上 ページ の 3 セクション (ブースト 以外):
 *   ・エージェント企業 Pro プラン 契約一覧
 *   ・サブスクリプション アドオン (meeting_recording_auto)
 *   ・返金 / 失効 履歴
 *
 * 1 リクエスト (/api/admin/billing-overview) で 全 3 セクション の データ を 取得 し、
 * 表示は カードで セクション分け。
 */
type UserMeta = {
  displayName: string | null;
  email: string | null;
};

type AddonRow = UserMeta & {
  id: string;
  userId: string;
  addonKey: string;
  status: "active" | "past_due" | "canceled";
  stripeSubscriptionItemId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
};

type RefundedBoost = UserMeta & {
  id: string;
  userId: string;
  effectiveFrom: string;
  effectiveUntil: string;
  stripeSessionId: string | null;
  purchasedAt: string;
  refundedAt: string;
};

type CanceledAddon = UserMeta & {
  id: string;
  userId: string;
  addonKey: string;
  stripeSubscriptionItemId: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string;
};

type ApiResponse = {
  proPlans: {
    implemented: boolean;
    contracts: unknown[];
    stats: { active: number; expired: number };
  };
  addons: {
    recent: AddonRow[];
    stats: { active: number; pastDue: number; canceled: number };
  };
  refundsAndExpiries: {
    refundedBoosts: RefundedBoost[];
    canceledAddons: CanceledAddon[];
    stats: { refundedBoostCount: number; canceledAddonCount: number };
  };
};

const ADDON_LABEL: Record<string, string> = {
  meeting_recording_auto: "会議録音 自動連携",
};

export function BillingOverviewSections() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/admin/billing-overview", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (active) setData(json);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, []);

  if (loading) return <p className="text-muted-foreground text-sm">読み込み中...</p>;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-8">
      <ProPlansSection proPlans={data.proPlans} />
      <AddonsSection addons={data.addons} />
      <RefundsSection refunds={data.refundsAndExpiries} />
    </div>
  );
}

// ─────────────────────────────────────────
// ① Pro プラン 契約一覧
// ─────────────────────────────────────────
function ProPlansSection({ proPlans }: { proPlans: ApiResponse["proPlans"] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">エージェント企業 Pro プラン 契約一覧</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Zoom 録音 → AI 履歴書生成 / 月次 AI 上限引上 を 提供する 月額プラン。 手動切替 (運営者
          操作) で 開始。
        </p>
      </div>

      {!proPlans.implemented ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-xs">
          <p className="font-medium">機能 開発中</p>
          <p className="text-muted-foreground mt-1">
            Pro プラン (organizations.plan カラム) は まだ 実装 されて いません。
            docs/agency-pro-plan-design.md の Phase 1 着手後 ここに 契約一覧が 表示されます。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard label="現在 Pro 契約中" value={`${proPlans.stats.active} 社`} tone="primary" />
          <StatCard label="期限切れ / 解約" value={`${proPlans.stats.expired} 社`} />
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────
// ② サブスクリプション アドオン
// ─────────────────────────────────────────
function AddonsSection({ addons }: { addons: ApiResponse["addons"] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">サブスクリプション アドオン</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          求職者向け 月額アドオン (会議録音 自動連携 等)。 Stripe Subscription 経由。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="active" value={`${addons.stats.active} 件`} tone="primary" />
        <StatCard
          label="past_due (支払い 遅延)"
          value={`${addons.stats.pastDue} 件`}
          tone="warning"
        />
        <StatCard label="canceled (解約)" value={`${addons.stats.canceled} 件`} />
      </div>

      {addons.recent.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          まだ アドオン 契約は ありません (Stripe Subscription 連携後 ここに 表示されます)。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
          <table className="min-w-full bg-white text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">アドオン</th>
                <th className="px-3 py-2 text-left font-medium">求職者</th>
                <th className="px-3 py-2 text-left font-medium">メール</th>
                <th className="px-3 py-2 text-left font-medium">状態</th>
                <th className="px-3 py-2 text-left font-medium">次回 課金日</th>
                <th className="px-3 py-2 text-left font-medium">開始 / 更新</th>
              </tr>
            </thead>
            <tbody>
              {addons.recent.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 align-top">{ADDON_LABEL[a.addonKey] ?? a.addonKey}</td>
                  <td className="px-3 py-2 align-top">
                    {a.displayName ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-[10px]">
                    {a.email ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-3 py-2 align-top text-[10px] whitespace-nowrap">
                    {a.currentPeriodEnd
                      ? new Date(a.currentPeriodEnd).toLocaleDateString("ja-JP")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-[10px] whitespace-nowrap">
                    <div>{new Date(a.createdAt).toLocaleDateString("ja-JP")} 〜</div>
                    <div className="text-slate-500">
                      更新: {new Date(a.updatedAt).toLocaleDateString("ja-JP")}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────
// ③ 返金 / 失効 履歴
// ─────────────────────────────────────────
function RefundsSection({ refunds }: { refunds: ApiResponse["refundsAndExpiries"] }) {
  const { refundedBoosts, canceledAddons, stats } = refunds;
  const empty = refundedBoosts.length === 0 && canceledAddons.length === 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">返金 / 失効 履歴</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          返金された ブーストチケット と 解約された アドオン の 履歴。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="ブースト 返金" value={`${stats.refundedBoostCount} 件`} tone="warning" />
        <StatCard label="アドオン 解約" value={`${stats.canceledAddonCount} 件`} tone="warning" />
      </div>

      {empty ? (
        <p className="text-muted-foreground text-xs">返金 / 失効 履歴 は ありません。</p>
      ) : (
        <div className="space-y-3">
          {refundedBoosts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">ブースト返金</h3>
              <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
                <table className="min-w-full bg-white text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">返金日</th>
                      <th className="px-3 py-2 text-left font-medium">求職者</th>
                      <th className="px-3 py-2 text-left font-medium">購入日</th>
                      <th className="px-3 py-2 text-left font-medium">Stripe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refundedBoosts.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          {new Date(r.refundedAt).toLocaleString("ja-JP")}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {r.displayName ?? <span className="text-slate-400">—</span>}
                          <div className="font-mono text-[10px] text-slate-500">{r.email}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-[10px] whitespace-nowrap">
                          {new Date(r.purchasedAt).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {r.stripeSessionId ? (
                            <a
                              href={`https://dashboard.stripe.com/payments/${r.stripeSessionId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[10px] text-blue-600 underline"
                            >
                              {r.stripeSessionId.slice(0, 12)}...
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canceledAddons.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">アドオン 解約</h3>
              <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
                <table className="min-w-full bg-white text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">解約日 (更新)</th>
                      <th className="px-3 py-2 text-left font-medium">アドオン</th>
                      <th className="px-3 py-2 text-left font-medium">求職者</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canceledAddons.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          {new Date(a.updatedAt).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {ADDON_LABEL[a.addonKey] ?? a.addonKey}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {a.displayName ?? <span className="text-slate-400">—</span>}
                          <div className="font-mono text-[10px] text-slate-500">{a.email}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────
// 共通: StatCard と StatusBadge
// ─────────────────────────────────────────
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "primary" | "warning";
}) {
  const valueClass =
    tone === "primary"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <div className="rounded-md border bg-white p-3">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "past_due" | "canceled" }) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    active: { label: "active", cls: "bg-emerald-100 text-emerald-800" },
    past_due: { label: "past_due", cls: "bg-amber-100 text-amber-800" },
    canceled: { label: "canceled", cls: "bg-slate-100 text-slate-700" },
  };
  const m = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
  );
}

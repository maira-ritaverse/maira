"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 求職者 ドキュメント作成 ブーストチケット 購入履歴 セクション。
 *
 * ¥2,000 / 3 ヶ月有効 / スタック可 の 単発 課金 (Phase 3 で Stripe 連携)。
 * 上部に 統計 (当月 件数 + 売上 + 累計)、下に 直近 50 件の 一覧。
 */
type Purchase = {
  id: string;
  userId: string;
  userDisplayName: string | null;
  userEmail: string | null;
  effectiveFrom: string;
  effectiveUntil: string;
  multiplierDelta: number;
  stripeSessionId: string | null;
  purchasedAt: string;
  refundedAt: string | null;
};

type ApiResponse = {
  recent: Purchase[];
  stats: {
    monthCount: number;
    monthRevenue: number;
    totalCount: number;
    totalRevenue: number;
    refundedCount: number;
  };
};

export function SeekerBoostsSection() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/admin/seeker-boost-purchases", { signal: ctrl.signal });
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

  const { recent, stats } = data;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">
          求職者 ドキュメント作成 ブーストチケット(¥2,000 / 3 ヶ月有効)
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          履歴書 + 職務経歴書 の 月次作成枠 を +10 件 / 月、3 ヶ月間 拡張する 単発課金。
        </p>
      </div>

      {/* 統計 4 つ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard label="当月 購入 件数" value={`${stats.monthCount} 件`} />
        <StatCard
          label="当月 概算 売上"
          value={`¥${stats.monthRevenue.toLocaleString()}`}
          tone="primary"
        />
        <StatCard label="累計 (有効) 件数" value={`${stats.totalCount} 件`} />
        <StatCard
          label="累計 概算 売上"
          value={`¥${stats.totalRevenue.toLocaleString()}`}
          tone="primary"
        />
      </div>

      {stats.refundedCount > 0 && (
        <p className="text-muted-foreground text-xs">(うち 返金済: {stats.refundedCount} 件)</p>
      )}

      {/* 直近 50 件 */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">直近 50 件 の 購入履歴</h3>
        {recent.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            まだ 購入は ありません (Stripe 連携 完了後 ここに 表示されます)。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
            <table className="min-w-full bg-white text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">購入日時</th>
                  <th className="px-3 py-2 text-left font-medium">求職者</th>
                  <th className="px-3 py-2 text-left font-medium">メール</th>
                  <th className="px-3 py-2 text-left font-medium">有効期間</th>
                  <th className="px-3 py-2 text-left font-medium">追加 件数</th>
                  <th className="px-3 py-2 text-left font-medium">Stripe</th>
                  <th className="px-3 py-2 text-left font-medium">状態</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {new Date(p.purchasedAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {p.userDisplayName ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-mono text-[10px]">
                        {p.userEmail ?? <span className="text-slate-400">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      <span className="text-[10px]">
                        {new Date(p.effectiveFrom).toLocaleDateString("ja-JP")}
                        {" 〜 "}
                        {new Date(p.effectiveUntil).toLocaleDateString("ja-JP")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right align-top">+{p.multiplierDelta} 件 / 月</td>
                    <td className="px-3 py-2 align-top">
                      {p.stripeSessionId ? (
                        <a
                          href={`https://dashboard.stripe.com/payments/${p.stripeSessionId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-blue-600 underline"
                        >
                          {p.stripeSessionId.slice(0, 12)}...
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {p.refundedAt ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                          返金済 {new Date(p.refundedAt).toLocaleDateString("ja-JP")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                          有効
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  const valueClass = tone === "primary" ? "text-emerald-700" : "text-foreground";
  return (
    <div className="rounded-md border bg-white p-3">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

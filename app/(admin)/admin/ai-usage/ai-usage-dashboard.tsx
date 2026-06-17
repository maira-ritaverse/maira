"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import { formatJpy } from "@/lib/features/ai-pricing";

type Bucket = {
  month: string;
  total: number;
  byKind: Record<string, number>;
  uniqueUsers: number;
  estimatedCostJpy: number;
};

type UsageResponse = {
  months: number;
  buckets: Bucket[];
  thisMonth: Bucket | null;
  grandTotal: number;
  grandTotalCostJpy: number;
};

/**
 * kind ラベル(UI 表示用 + 列順固定のため)。
 * ai_usage_events に新しい kind が増えたらここを更新。
 */
const KIND_ORDER = [
  "photo_enhance",
  "job_recommendation_seeker",
  "job_recommendation_agency",
] as const;
type KnownKind = (typeof KIND_ORDER)[number];

const KIND_LABEL: Record<KnownKind, string> = {
  photo_enhance: "写真AI",
  job_recommendation_seeker: "求人推薦(seeker)",
  job_recommendation_agency: "求人推薦(agency)",
};

export function AiUsageDashboard() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void (async () => {
      try {
        const res = await apiFetch<UsageResponse>(`/api/admin/ai-usage?months=6`);
        setData(res ?? null);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <p className="text-muted-foreground text-sm">読み込み中…</p>;
  }
  if (error) {
    return <p className="text-destructive text-xs">{error}</p>;
  }
  if (!data) {
    return <p className="text-muted-foreground text-sm">データなし。</p>;
  }

  const { thisMonth, buckets, grandTotal, grandTotalCostJpy } = data;
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));

  return (
    <div className="space-y-6">
      {/* === 今月サマリ(コストを含む) === */}
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="今月の AI 呼出" value={(thisMonth?.total ?? 0).toLocaleString()} />
        <SummaryCard
          label="今月のユニークユーザ"
          value={(thisMonth?.uniqueUsers ?? 0).toLocaleString()}
        />
        <SummaryCard label="今月の推定コスト" value={formatJpy(thisMonth?.estimatedCostJpy ?? 0)} />
        <SummaryCard label="6 か月合計" value={grandTotal.toLocaleString()} />
      </div>
      <p className="text-muted-foreground text-[10px]">
        ※推定コストは kind 別の平均単価による概算で、厳密な原価ではなく桁感の把握用です。 6
        か月合計コスト:{formatJpy(grandTotalCostJpy)}
      </p>

      {/* === kind 別の今月内訳 === */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">今月の kind 別内訳</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {KIND_ORDER.map((k) => (
            <div key={k} className="rounded border p-3 text-sm">
              <div className="text-muted-foreground text-xs">{KIND_LABEL[k]}</div>
              <div className="text-xl font-bold">
                {(thisMonth?.byKind[k] ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* === 月別推移(シンプル横棒) === */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">月別推移(直近 6 か月)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-2 py-2">月</th>
                <th className="px-2 py-2">合計</th>
                {KIND_ORDER.map((k) => (
                  <th key={k} className="px-2 py-2">
                    {KIND_LABEL[k]}
                  </th>
                ))}
                <th className="px-2 py-2">ユニーク</th>
                <th className="px-2 py-2">推定コスト</th>
                <th className="px-2 py-2">グラフ</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const pct = Math.round((b.total / maxTotal) * 100);
                return (
                  <tr key={b.month} className="border-b last:border-b-0">
                    <td className="px-2 py-2 font-mono text-xs">{b.month}</td>
                    <td className="px-2 py-2 font-semibold">{b.total.toLocaleString()}</td>
                    {KIND_ORDER.map((k) => (
                      <td key={k} className="px-2 py-2 text-xs">
                        {(b.byKind[k] ?? 0).toLocaleString()}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-xs">{b.uniqueUsers.toLocaleString()}</td>
                    <td className="px-2 py-2 text-xs font-semibold">
                      {formatJpy(b.estimatedCostJpy)}
                    </td>
                    <td className="w-32 px-2 py-2">
                      <div className="bg-muted h-2 w-full rounded">
                        <div className="bg-primary h-2 rounded" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

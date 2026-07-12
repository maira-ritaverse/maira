/**
 * ROI(admin 限定表示)
 *
 * report_costs に月次コストが入っていれば、期間内のコスト合計と純売上から
 * ROI を計算して表示。 内訳・月次推移も可視化。
 */
"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoiSummary } from "@/lib/reports/queries";

type Props = { data: RoiSummary; isAdmin: boolean };

export function RoiSection({ data, isAdmin }: Props) {
  const noCost = data.totalCost === 0;

  const roiToneClass =
    data.roiPercent == null
      ? "text-slate-500"
      : data.roiPercent >= 0
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-rose-700 dark:text-rose-400";

  return (
    <Card>
      <CardHeader>
        <CardTitle>ROI(投資対効果)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          管理者(admin)向け:月次コストと純売上から ROI を計算します。 ROI = (純売上 − コスト合計) ÷
          コスト合計 × 100。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {noCost ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm">
            <p className="text-muted-foreground">この期間の月次コストが登録されていません。</p>
            {isAdmin && (
              <Link
                href="/agency/reports/settings"
                className="text-primary mt-2 inline-block text-xs underline underline-offset-2"
              >
                レポート設定でコストを入力する
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* サマリー 4 タイル */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryTile label="コスト合計" value={formatYenShort(data.totalCost)} />
              <SummaryTile label="純売上" value={formatYenShort(data.netRevenue)} emphasize />
              <SummaryTile
                label="利益"
                value={formatYenShort(data.profit)}
                tone={data.profit >= 0 ? "positive" : "negative"}
              />
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground text-xs">ROI</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${roiToneClass}`}>
                  {data.roiPercent == null ? "-" : `${data.roiPercent}%`}
                </p>
              </div>
            </div>

            {/* 月次推移 */}
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
                <ComposedChart
                  data={data.months}
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="yen"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => formatYenAxis(v)}
                    width={56}
                  />
                  <YAxis
                    yAxisId="roi"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `${v}%`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === "revenue") return [formatYen(Number(value)), "純売上"];
                      if (name === "cost") return [formatYen(Number(value)), "コスト"];
                      if (name === "roi") return [`${value}%`, "ROI"];
                      return [String(value), String(name)];
                    }}
                    labelStyle={{ fontSize: 12 }}
                    contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(v) =>
                      v === "revenue" ? "純売上" : v === "cost" ? "コスト" : "ROI %"
                    }
                  />
                  <Bar
                    yAxisId="yen"
                    dataKey="cost"
                    fill="#f43f5e"
                    opacity={0.6}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="yen"
                    dataKey="revenue"
                    fill="#10b981"
                    opacity={0.6}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="roi"
                    type="monotone"
                    dataKey="roi"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* コスト内訳 */}
            <div>
              <p className="text-muted-foreground mb-2 text-xs">コスト内訳(期間合計)</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <BreakdownTile label="マーケ" value={formatYenShort(data.breakdown.marketing)} />
                <BreakdownTile label="ツール" value={formatYenShort(data.breakdown.tool)} />
                <BreakdownTile label="人件費" value={formatYenShort(data.breakdown.personnel)} />
                <BreakdownTile label="その他" value={formatYenShort(data.breakdown.other)} />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  emphasize = false,
  tone = "neutral",
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: "neutral" | "positive" | "negative";
}) {
  const cls =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-700 dark:text-rose-400"
        : "";
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={`mt-1 tabular-nums ${emphasize ? "text-2xl font-semibold" : "text-lg font-semibold"} ${cls}`}
      >
        {value}
      </p>
    </div>
  );
}

function BreakdownTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-slate-50 p-2 text-center dark:bg-slate-900/40">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}
function formatYenAxis(n: number): string {
  if (n === 0) return "¥0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}¥${(abs / 100_000_000).toFixed(1)}億`;
  if (abs >= 10_000) return `${sign}¥${Math.round(abs / 10_000)}万`;
  return `${sign}¥${abs.toLocaleString("ja-JP")}`;
}
function formatYenShort(n: number): string {
  if (n === 0) return "¥0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100_000_000)
    return `${sign}¥${(abs / 100_000_000).toFixed(2).replace(/\.?0+$/, "")}億`;
  if (abs >= 10_000) return `${sign}¥${Math.round(abs / 10_000)}万`;
  return `${sign}¥${abs.toLocaleString("ja-JP")}`;
}

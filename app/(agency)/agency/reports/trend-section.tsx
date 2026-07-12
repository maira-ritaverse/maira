"use client";

/**
 * A:過去 12 か月の時系列トレンド
 *
 * 成約数・応募数・面談数を折れ線、純売上を右軸の棒で表示。
 * KPI ヘッドラインが「点」なら、こちらは「線」で流れを見る。
 */
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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyTrendBucket } from "@/lib/reports/queries";

type Props = { data: MonthlyTrendBucket[] };

export function TrendSection({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>時系列トレンド(過去 12 か月)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          月ごとの成約・応募・面談件数と純売上の推移。 期間フィルタとは独立に、 常に「直近 12
          か月」を表示します。
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
              <YAxis
                yAxisId="revenue"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => formatYenAxis(v)}
                width={56}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "netRevenue") return [formatYen(Number(value)), "純売上"];
                  if (name === "placementCount") return [`${value} 件`, "成約"];
                  if (name === "applicationCount") return [`${value} 件`, "応募"];
                  if (name === "interviewCount") return [`${value} 件`, "面談"];
                  return [String(value), String(name)];
                }}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => {
                  if (value === "netRevenue") return "純売上";
                  if (value === "placementCount") return "成約";
                  if (value === "applicationCount") return "応募";
                  if (value === "interviewCount") return "面談";
                  return value;
                }}
              />
              <Bar
                yAxisId="revenue"
                dataKey="netRevenue"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                opacity={0.6}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="applicationCount"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="interviewCount"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="placementCount"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
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

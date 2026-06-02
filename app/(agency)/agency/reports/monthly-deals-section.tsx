"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyDealsRevenue } from "@/lib/reports/queries";

type Props = {
  data: MonthlyDealsRevenue;
};

/**
 * A:成約・売上(月別)
 *
 * 純売上(棒)と成約数(線)を 2 軸の ComposedChart で重ねる。
 *   - 売上(円)と件数(個)はスケールが違うので 2 軸が必要
 *   - 棒=売上を主、線=件数を補助として読ませる
 *
 * 期間内の月はすべてバケットに含めている(0 件月も棒が出ない代わりに
 * 軸目盛として残る)。「データが無い月」が一目で分かるように。
 *
 * ⚠️ 金額の計算は server 側で aggregatePlacements を再利用しているため、
 *    成約管理画面と必ず一致する。ここ(描画側)では計算しない。
 */
export function MonthlyDealsSection({ data }: Props) {
  const { buckets, total, period } = data;
  const hasData = total.placementCount > 0 || total.netRevenue !== 0 || total.paid > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>成約・売上(月別)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          {period.from} 〜 {period.to} の event_date で集計しています。 純売上 = 成約 + 追加報酬 −
          返金(成約管理画面と同じロジック)。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 期間合計サマリ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="成約件数" value={`${total.placementCount} 件`} />
          <SummaryTile label="純売上" value={formatYen(total.netRevenue)} emphasize />
          <SummaryTile label="入金済み" value={formatYen(total.paid)} />
          <SummaryTile
            label="返金"
            value={formatYen(total.refundTotal)}
            tone={total.refundTotal > 0 ? "negative" : "neutral"}
          />
        </div>

        {/* グラフ:売上(棒)+ 件数(線)の 2 軸 */}
        {hasData ? (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={buckets} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                {/* 左軸:売上(円)。万単位の目盛りで表示 */}
                <YAxis
                  yAxisId="revenue"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => formatYenAxis(v)}
                  width={64}
                />
                {/* 右軸:成約数(件)。0 始まりで整数 */}
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  width={28}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "netRevenue") return [formatYen(Number(value)), "純売上"];
                    if (name === "placementCount") return [`${value} 件`, "成約数"];
                    return [String(value), String(name)];
                  }}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                />
                <Bar
                  yAxisId="revenue"
                  dataKey="netRevenue"
                  name="netRevenue"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="placementCount"
                  name="placementCount"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            この期間に成約・入金・返金・追加報酬の記録はありません。
          </p>
        )}

        {/* 月別の数字内訳 */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-2 pr-3 font-normal">月</th>
                <th className="py-2 pr-3 text-right font-normal">成約数</th>
                <th className="py-2 pr-3 text-right font-normal">純売上</th>
                <th className="py-2 text-right font-normal">入金済み</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.month} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">{b.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{b.placementCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatYen(b.netRevenue)}</td>
                  <td className="py-2 text-right tabular-nums">{formatYen(b.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  tone?: "neutral" | "negative";
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={`mt-1 tabular-nums ${emphasize ? "text-lg font-semibold" : "text-base"} ${
          tone === "negative" ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** 円表記。整数前提なので少数は出さない(国内通貨 + サブカン区切り)。 */
function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

/** Y 軸用に短く表示(1,000,000 → ¥100万、1,000,000,000 → ¥10億)。 */
function formatYenAxis(n: number): string {
  if (n === 0) return "¥0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}¥${(abs / 100_000_000).toFixed(1)}億`;
  if (abs >= 10_000) return `${sign}¥${Math.round(abs / 10_000)}万`;
  return `${sign}¥${abs.toLocaleString("ja-JP")}`;
}

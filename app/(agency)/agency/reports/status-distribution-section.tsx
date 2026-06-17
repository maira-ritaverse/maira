"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatusDistribution } from "@/lib/reports/queries";
import type { ClientStatus } from "@/lib/clients/types";
import type { ReferralStatus } from "@/lib/referrals/types";

type Props = {
  clients: StatusDistribution<ClientStatus>;
  referrals: StatusDistribution<ReferralStatus>;
};

/**
 * D-1:ステータス分布(求職者・紹介の今のスナップショット)
 *
 * 横棒グラフを採用した理由:
 *   - ステータスが 6〜7 個あるので円グラフだと小さくて読めない
 *   - ラベルが日本語(長め)で、縦軸に置くと折り返し問題が無い
 *   - 値の大小比較が直感的
 *
 * 件数も併記する(グラフが小さくても数字で正確に読めるように)。
 * 0 件のステータスもバー自体は描画しないが、ラベル一覧には残す
 * (どのステータスに 0 件いるかを示すため)。
 *
 * recharts は SSR でも動くが、ResponsiveContainer がレイアウト計算で
 * クライアント描画を必要とするため "use client" を付ける。
 */
export function StatusDistributionSection({ clients, referrals }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ステータス分布(現在のスナップショット)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          求職者・紹介が、今どの段階に何件あるかを表示します。期間フィルタには連動しません。
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <DistributionPanel
          title="求職者(クライアント)"
          subtitle={`合計 ${clients.total} 人`}
          data={clients.buckets}
        />
        <DistributionPanel
          title="紹介(マッチング)"
          subtitle={`合計 ${referrals.total} 件`}
          data={referrals.buckets}
        />
      </CardContent>
    </Card>
  );
}

type Bucket = {
  status: string;
  label: string;
  count: number;
  color: string;
};

function DistributionPanel({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: Bucket[];
}) {
  // recharts に渡すデータ。description / detail カラムは UI 表示用なので別途持つ。
  const chartData = data.map((b) => ({
    name: b.label,
    count: b.count,
    color: b.color,
  }));

  const maxCount = Math.max(1, ...data.map((b) => b.count));

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{subtitle}</p>
      </div>

      {/* グラフ */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          >
            <XAxis
              type="number"
              allowDecimals={false}
              domain={[0, maxCount]}
              tick={{ fontSize: 11 }}
            />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={72} />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              formatter={(value) => [`${value} 件`, ""]}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 件数の併記(0 件のステータスも省略せず一覧化) */}
      <ul className="space-y-1 text-sm">
        {data.map((b) => (
          <li key={b.status} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ backgroundColor: b.color }}
                aria-hidden="true"
              />
              <span>{b.label}</span>
            </span>
            <span className="text-muted-foreground tabular-nums">{b.count} 件</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

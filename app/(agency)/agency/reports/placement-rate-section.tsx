"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { colorForPlacementRate } from "@/lib/reports/placement-rate-colors";
import type { PlacementRate } from "@/lib/reports/queries";

type Props = {
  data: PlacementRate;
};

/**
 * F:成約率(半円ゲージ)
 *
 * 「期間内に作成された紹介のうち、status='joined' に到達した割合」を
 * 数値と半円ゲージで可視化する。
 *
 * 閾値別に色を変える(spec 指定):
 *   0-30%   → 赤(改善余地大)
 *   31-60%  → 黄(伸びしろあり)
 *   61-100% → 緑(良好)
 *
 * recharts は SSR でも動くが、ResponsiveContainer がレイアウト計算で
 * クライアント描画を必要とするため "use client"。
 *
 * 母数 0 のときは rate=null。ゼロ除算を避け、UI は「データなし」表示にする。
 */
export function PlacementRateSection({ data }: Props) {
  const { rate, totalReferrals, totalPlacements, period } = data;
  const hasData = totalReferrals > 0 && rate !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>成約率</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          {period.from} 〜 {period.to} に作成された紹介(referrals.created_at)を母数に、
          status=&#39;joined&#39; 到達数で算出。
        </p>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <Gauge rate={rate} referrals={totalReferrals} placements={totalPlacements} />
        ) : (
          <EmptyState />
        )}
      </CardContent>
    </Card>
  );
}

function Gauge({
  rate,
  referrals,
  placements,
}: {
  rate: number;
  referrals: number;
  placements: number;
}) {
  // 100% を超える値は理論上発生しないが、表示クランプで保険を掛ける。
  const clamped = Math.max(0, Math.min(100, rate));
  const color = colorForPlacementRate(clamped);

  // recharts はオブジェクト配列を要求するので 1 要素配列にして渡す。
  const chartData = [{ name: "rate", value: clamped, fill: color }];

  return (
    <div className="grid items-center gap-6 md:grid-cols-[18rem_1fr]">
      {/* 半円ゲージ + センターラベル */}
      <div className="relative mx-auto h-44 w-72 md:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="100%"
            innerRadius="120%"
            outerRadius="160%"
            data={chartData}
            startAngle={180}
            endAngle={0}
            barSize={20}
          >
            {/* domain を 0-100 に固定して、value が % のまま角度に変換される */}
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background dataKey="value" cornerRadius={6} />
          </RadialBarChart>
        </ResponsiveContainer>
        {/* 円の中央(=下端)に数値を配置 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center">
          <span className="text-3xl font-semibold tabular-nums" style={{ color }}>
            {clamped.toFixed(2)}%
          </span>
          <span className="text-muted-foreground text-xs">成約率</span>
        </div>
      </div>

      {/* 数値内訳 */}
      <div className="grid grid-cols-2 gap-3">
        <Metric label="紹介" value={`${referrals} 件`} />
        <Metric label="成約" value={`${placements} 件`} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
      この期間に作成された紹介がないため、成約率は計算できません。
    </p>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-base tabular-nums">{value}</p>
    </div>
  );
}

// 成約率の色しきい値は lib/reports/placement-rate-colors.ts に集約。
// テストも同ファイルで境界値(30/31/60/61)を固定済み。

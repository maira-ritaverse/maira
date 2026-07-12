import {
  ArrowDownRight,
  ArrowUpRight,
  Briefcase,
  CalendarCheck,
  TrendingUp,
  Users,
} from "lucide-react";

import type { KpiSummary } from "@/lib/reports/queries";

type Props = {
  current: KpiSummary;
  previous: KpiSummary;
};

/**
 * レポート最上部の KPI ヘッドライン(4 タイル)。
 *
 * ・成約件数 / 純売上 / 応募件数 / 面談実施数 を大きく表示
 * ・前期比(絶対差 + %)を右下に添える
 * ・0/0 の場合は「-」を表示
 *
 * サーバー描画で完結する(interactivity なし)。
 */
export function KpiHeadline({ current, previous }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile
        icon={<TrendingUp className="size-4" aria-hidden />}
        label="成約件数"
        value={`${current.placementCount} 件`}
        prevValue={previous.placementCount}
        currValue={current.placementCount}
        higherIsBetter
      />
      <KpiTile
        icon={<Briefcase className="size-4" aria-hidden />}
        label="純売上"
        value={formatYenShort(current.netRevenue)}
        prevValue={previous.netRevenue}
        currValue={current.netRevenue}
        higherIsBetter
        emphasize
      />
      <KpiTile
        icon={<Users className="size-4" aria-hidden />}
        label="応募件数"
        value={`${current.applicationCount} 件`}
        prevValue={previous.applicationCount}
        currValue={current.applicationCount}
        higherIsBetter
      />
      <KpiTile
        icon={<CalendarCheck className="size-4" aria-hidden />}
        label="面談"
        value={`${current.interviewCount} 件`}
        prevValue={previous.interviewCount}
        currValue={current.interviewCount}
        higherIsBetter
      />
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  prevValue,
  currValue,
  higherIsBetter,
  emphasize = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  prevValue: number;
  currValue: number;
  higherIsBetter: boolean;
  emphasize?: boolean;
}) {
  const delta = currValue - prevValue;
  const pct = prevValue === 0 ? null : Math.round((delta / prevValue) * 100);
  const up = delta > 0;
  const down = delta < 0;
  const isGood = higherIsBetter ? up : down;
  const isBad = higherIsBetter ? down : up;

  return (
    <div className="bg-background rounded-md border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 tabular-nums ${emphasize ? "text-2xl" : "text-xl"} font-semibold`}>
        {value}
      </div>
      <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[10px]">
        <span>前期比</span>
        {delta === 0 ? (
          <span>±0</span>
        ) : (
          <span
            className={`inline-flex items-center gap-0.5 ${
              isGood
                ? "text-emerald-700 dark:text-emerald-400"
                : isBad
                  ? "text-rose-700 dark:text-rose-400"
                  : ""
            }`}
          >
            {up ? <ArrowUpRight className="size-3" aria-hidden /> : null}
            {down ? <ArrowDownRight className="size-3" aria-hidden /> : null}
            {pct !== null ? `${up ? "+" : ""}${pct}%` : `${up ? "+" : ""}${delta}`}
          </span>
        )}
      </div>
    </div>
  );
}

/** 大きな数値を短く表示(1,000,000 → ¥100万) */
function formatYenShort(n: number): string {
  if (n === 0) return "¥0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100_000_000)
    return `${sign}¥${(abs / 100_000_000).toFixed(2).replace(/\.?0+$/, "")}億`;
  if (abs >= 10_000) return `${sign}¥${Math.round(abs / 10_000)}万`;
  return `${sign}¥${abs.toLocaleString("ja-JP")}`;
}

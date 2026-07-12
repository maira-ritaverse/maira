/**
 * D:目標達成率
 *
 * report_targets に月次目標が入っていれば、対象期間の目標と実績を並べて
 * 達成率を表示。 未入力の場合は誘導文言を表示。
 */
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AchievementRow } from "@/lib/reports/queries";

type Props = { rows: AchievementRow[] | null; isAdmin: boolean };

export function AchievementSection({ rows, isAdmin }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>目標達成率</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          管理者が設定した月次目標に対する、対象期間の達成率を表示します。
        </p>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm">
            <p className="text-muted-foreground">この期間の月次目標が設定されていません。</p>
            {isAdmin && (
              <Link
                href="/agency/reports/settings"
                className="text-primary mt-2 inline-block text-xs underline underline-offset-2"
              >
                レポート設定で目標を入力する
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map((r) => (
              <AchievementTile
                key={r.label}
                label={r.label}
                actual={r.actual}
                target={r.target}
                percent={r.achievedPercent}
                isYen={r.label === "純売上"}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AchievementTile({
  label,
  actual,
  target,
  percent,
  isYen,
}: {
  label: string;
  actual: number;
  target: number;
  percent: number | null;
  isYen: boolean;
}) {
  const fmt = (n: number) => (isYen ? formatYenShort(n) : `${n} 件`);
  const pctForBar = percent == null ? 0 : Math.min(120, Math.max(0, percent));
  const tone =
    percent == null
      ? "bg-slate-300 dark:bg-slate-700"
      : percent >= 100
        ? "bg-emerald-500"
        : percent >= 70
          ? "bg-amber-500"
          : "bg-rose-500";

  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums">{fmt(actual)}</p>
        <p className="text-muted-foreground text-xs tabular-nums">/ {fmt(target)}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
          <div className={`h-2 rounded ${tone}`} style={{ width: `${pctForBar}%` }} />
        </div>
        <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
          {percent == null ? "-" : `${percent}%`}
        </span>
      </div>
    </div>
  );
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

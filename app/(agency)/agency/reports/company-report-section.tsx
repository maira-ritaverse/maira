/**
 * B:企業別レポート
 *
 * 期間内の応募 + 成約を求人企業単位で集計。
 * 表 + 上位企業のバーで表示。
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompanyReportRow } from "@/lib/reports/queries";

type Props = { rows: CompanyReportRow[] };

export function CompanyReportSection({ rows }: Props) {
  const top = rows.slice(0, 10);
  const maxRevenue = Math.max(1, ...top.map((r) => r.netRevenue));

  return (
    <Card>
      <CardHeader>
        <CardTitle>企業別レポート(上位 10 社)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          期間内の応募と成約を求人企業単位で集計。 純売上降順で並べています。
        </p>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            この期間に応募・成約の記録がありません。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-3 font-normal">企業名</th>
                  <th className="py-2 pr-3 text-right font-normal">応募</th>
                  <th className="py-2 pr-3 text-right font-normal">成約</th>
                  <th className="py-2 pr-3 text-right font-normal">純売上</th>
                  <th className="py-2 font-normal">売上シェア</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r) => {
                  const pct = maxRevenue > 0 ? (r.netRevenue / maxRevenue) * 100 : 0;
                  return (
                    <tr key={r.companyName} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-medium">{r.companyName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.applicationCount}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.placementCount}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatYen(r.netRevenue)}
                      </td>
                      <td className="py-2">
                        <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-2 rounded bg-emerald-500"
                            style={{ width: `${Math.max(2, pct)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

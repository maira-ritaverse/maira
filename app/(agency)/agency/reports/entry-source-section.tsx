/**
 * C:エントリーサイト別レポート
 *
 * 求職者の入り口(entry_source_code)ごとに、獲得 → 応募 → 成約の流れを集計。
 * 応募 → 成約 の変換率を「効率」として表示する。
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EntrySourceReportRow } from "@/lib/reports/queries";

type Props = { rows: EntrySourceReportRow[] };

export function EntrySourceSection({ rows }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>エントリーサイト別レポート</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          求職者の入り口(登録元)ごとに、獲得 → 応募 → 成約 の流れを集計。 「変換率」=
          応募のうち成約に至った割合。
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            この期間にエントリーサイト別の記録がありません。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-3 font-normal">登録元</th>
                  <th className="py-2 pr-3 text-right font-normal">獲得</th>
                  <th className="py-2 pr-3 text-right font-normal">応募</th>
                  <th className="py-2 pr-3 text-right font-normal">成約</th>
                  <th className="py-2 pr-3 text-right font-normal">変換率</th>
                  <th className="py-2 text-right font-normal">純売上</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entrySource} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 font-medium">{r.entrySource}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.clientCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.applicationCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.placementCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.conversionRate == null ? "-" : `${r.conversionRate}%`}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatYen(r.netRevenue)}</td>
                  </tr>
                ))}
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

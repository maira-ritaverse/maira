import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PhaseDuration } from "@/lib/reports/queries";

type Props = {
  data: PhaseDuration;
};

/**
 * E:各フェーズの所要日数
 *
 * referral_status_history(機能が新しく、まだ履歴データが少ない)を母数に
 * 平均日数を出す。サンプル数を併記して、信頼度を読み手に判断させる。
 *
 * ⚠️ サンプル 0 の区間は averageDays = null。「0 日」と表示すると
 *    「即日通過」と誤解されるため、必ず「—」で示す。
 *
 * Server Component。
 */
export function PhaseDurationSection({ data }: Props) {
  const { intervals, period } = data;
  const totalSamples = intervals.reduce((s, iv) => s + iv.sampleCount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>各フェーズの所要日数</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          期間:{period.from} 〜 {period.to}
          {" / "}
          referral_status_history の遷移日(TO 側の changed_at)が期間内のものを集計しています。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-2 pr-3 font-normal">区間</th>
                <th className="py-2 pr-3 text-right font-normal">平均所要日数</th>
                <th className="py-2 text-right font-normal">サンプル</th>
              </tr>
            </thead>
            <tbody>
              {intervals.map((iv) => (
                <tr key={iv.key} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">{iv.label}</td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums ${
                      iv.averageDays === null ? "text-muted-foreground" : ""
                    }`}
                  >
                    {iv.averageDays === null ? "—" : `${iv.averageDays.toFixed(1)} 日`}
                  </td>
                  <td className="text-muted-foreground py-2 text-right text-xs tabular-nums">
                    {iv.sampleCount} 件
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/*
          注記:履歴蓄積の仕組みが新しいため、現時点はサンプルが少ない/無いのが正常。
          「データが無い区間」と「0 日(即日通過)」の違いを明示する。
        */}
        <div className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
          <p>
            フェーズ遷移履歴(referral_status_history)をもとに算出。
            履歴が蓄積されると精度が上がります。
          </p>
          <p>
            「—」表示はサンプル 0(未計測)で、「0 日」とは意味が異なります。
            飛ばし遷移・逆行・declined を含む遷移は集計対象外です。
          </p>
          {totalSamples === 0 && (
            <p>
              この期間にはまだ集計対象の遷移がありません。status
              を変更すると履歴が自動記録されます。
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SelectionFunnel } from "@/lib/reports/queries";

type Props = {
  data: SelectionFunnel;
};

/**
 * B:選考ファネル(通過率)
 *
 * ファネル可視化は recharts の FunnelChart ではなく、カスタムの横棒で描画する。
 * 理由:
 *   - 段階ごとに「件数 + 通過率%」を行内に並べたい(FunnelChart のラベルは制約が多い)
 *   - 6 段階で母数が小さいとき、FunnelChart は形が崩れやすい
 *   - ライブラリ依存を増やさない
 *
 * バーの幅は「母数(referred)に対する到達率」で決める。
 * 母数 0 のときは全段階 0% で平らになる(空状態のメッセージで補足)。
 *
 * 数え方:
 *   - status が interview なら、紹介・推薦・書類・面接 すべてに到達済みとカウント
 *   - declined は紹介到達(母数)のみカウント、それ以降には含まない
 *     →「不採用 N 件(紹介到達に含む)」を注記で明示
 *
 * Server Component。recharts を使わないので "use client" 不要。
 */
export function SelectionFunnelSection({ data }: Props) {
  const { stages, base, declinedCount, period } = data;
  const isEmpty = base === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>選考ファネル(通過率)</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          {period.from} 〜 {period.to} に作成された紹介(referrals.created_at)を母数に、 現在の
          status から到達段階を判定しています。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEmpty ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            この期間に作成された紹介がありません。
          </p>
        ) : (
          <ol className="space-y-2">
            {stages.map((s) => (
              <li key={s.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {s.count} 件 ({s.passRate}%)
                  </span>
                </div>
                <div className="bg-muted h-6 w-full overflow-hidden rounded-md">
                  {/*
                    バー幅は「passRate%」をそのまま使う(母数 0 のときは 0%)。
                    inline style にしているのは tailwind の動的クラスでは
                    任意の % を表現できないため(arbitrary value で書ける
                    が、recharts と違いここは中身が連続値なので style が素直)。
                  */}
                  <div
                    className="h-full rounded-md transition-all"
                    style={{
                      width: `${Math.max(s.passRate, base > 0 && s.count > 0 ? 2 : 0)}%`,
                      backgroundColor: s.color,
                    }}
                    aria-label={`${s.label} ${s.count} 件 ${s.passRate}%`}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}

        {/*
          declined の取り扱いを明示する注記。
          ユーザーが「脱落者がどこにいるか」をすぐ理解できるように、
          ファネル直下に「紹介到達の母数 / declined 件数」をセットで出す。
        */}
        <div className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
          <p>母数:紹介到達 {base} 件(declined 含む)</p>
          <p>
            内、不採用(declined):{declinedCount} 件
            <span className="ml-1 opacity-80">
              ※ 母数のみカウント。脱落段階の特定は現状の status からは追えない(履歴未参照)
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

import { clientCloseReasonLabels, type ClientCloseReason } from "@/lib/clients/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * クライアント一覧トップの分布サマリ。
 *
 * 失注理由(close_reason)とエントリーサイト(entry_site)の 2 軸を、横棒グラフ風に表示する。
 * サーバーコンポーネントとして親 page.tsx で集計結果を props として受け取り、
 * クライアント JS なしで静的にレンダリングする。
 *
 * 0 件のときは「データが集まり次第表示します」として丸めて非表示にしない
 * (運用上、エージェントが「いまどれくらい集まってるか」を一目で見たいので、
 *  入力が促されるようにしておく)。
 */

export type CloseReasonSummaryProps = {
  closeReasons: Record<string, number>;
  entrySites: Record<string, number>;
  totalClients: number;
};

export function CloseReasonSummary({
  closeReasons,
  entrySites,
  totalClients,
}: CloseReasonSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">失注理由の分布</CardTitle>
          <p className="text-muted-foreground text-xs">
            close_reason 別の件数(合計 {totalClients} 件)
          </p>
        </CardHeader>
        <CardContent>
          <DistributionList
            stats={closeReasons}
            total={totalClients}
            labelOf={(key) => closeReasonLabel(key)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">エントリーサイトの分布</CardTitle>
          <p className="text-muted-foreground text-xs">
            entry_site 別の件数(合計 {totalClients} 件)
          </p>
        </CardHeader>
        <CardContent>
          <DistributionList
            stats={entrySites}
            total={totalClients}
            labelOf={(key) => (key === "unset" ? "未設定" : key)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function closeReasonLabel(key: string): string {
  if (key === "unset") return "未設定";
  // ClientCloseReason の値域に当てはまれば日本語ラベル、それ以外は raw キー
  const k = key as ClientCloseReason;
  return clientCloseReasonLabels[k] ?? key;
}

/**
 * 内部:Record を「ラベル + 横棒 + 件数」のリスト UI に整形する。
 * 件数降順で並べる。0 件は表示しない。
 */
function DistributionList({
  stats,
  total,
  labelOf,
}: {
  stats: Record<string, number>;
  total: number;
  labelOf: (key: string) => string;
}) {
  const entries = Object.entries(stats)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-xs">データが集まり次第表示します</p>;
  }

  return (
    <ul className="space-y-1.5 text-xs">
      {entries.map(([key, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <li key={key} className="space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground">{labelOf(key)}</span>
              <span className="text-muted-foreground tabular-nums">
                {count} 件 ({pct}%)
              </span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded">
              <div className="bg-primary h-full rounded" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

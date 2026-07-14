import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdvisorPerformance } from "@/lib/reports/queries";

type Props = {
  data: AdvisorPerformance;
};

/**
 * C:アドバイザー別成績
 *
 * 表示は role で出し分け:
 *   - admin   : メンバー一覧テーブル(担当 referral / 成約数 / 純売上)
 *   - advisor : 自分のサマリ 1 枚だけ(他人のデータは server から来ない)
 *
 * 🔴 ここで「UI で隠す」分岐はしていない。advisor の場合は queries 側で
 *    そもそも自分のデータしか取得していない(devtools で他人の値は見えない)。
 *    この section は server から渡された rows をそのまま出すだけ。
 *
 * Server Component(recharts 不使用)。
 */
export function AdvisorPerformanceSection({ data }: Props) {
  const { rows, isAdmin, period } = data;
  const noData = rows.every(
    (r) => r.referralCount === 0 && r.placementCount === 0 && r.netRevenue === 0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isAdmin ? "アドバイザー別成績" : "あなたの成績"}</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          期間:{period.from} 〜 {period.to}
          {" / "}referral は created_at、placement は event_date
          で集計(売上ロジックは成約画面と同一)。
          {!isAdmin && " このセクションには、あなた以外のメンバーのデータは表示されません。"}
        </p>
      </CardHeader>
      <CardContent>
        {isAdmin ? (
          <AdminTable data={data} noData={noData} />
        ) : (
          <SelfCard data={data} noData={noData} />
        )}
      </CardContent>
    </Card>
  );
}

function AdminTable({ data, noData }: { data: AdvisorPerformance; noData: boolean }) {
  if (data.rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        メンバーが登録されていません。
      </p>
    );
  }
  // 売上ランキング(未割当を除いた実メンバーのみ)+ ビジュアル比較用の max
  const rankable = data.rows.filter((r) => !r.isUnassigned);
  const maxRevenue = Math.max(1, ...rankable.map((r) => r.netRevenue));

  // 世界標準の「Revenue per Recruiter」= CA 1 人あたりの生産性。 サマリタイルで表示
  const activeCount = rankable.filter((r) => r.placementCount > 0).length;
  const totalRevenue = rankable.reduce((s, r) => s + r.netRevenue, 0);
  const memberCount = rankable.length;
  const avgRevenuePerMember = memberCount > 0 ? Math.round(totalRevenue / memberCount) : 0;
  const topRevenue = rankable.length > 0 ? rankable[0].netRevenue : 0;

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="アクティブメンバー" value={`${activeCount} / ${memberCount} 名`} />
        <SummaryTile
          label="1 人あたり平均売上"
          value={`¥${avgRevenuePerMember.toLocaleString("ja-JP")}`}
          emphasize
        />
        <SummaryTile label="トップ成績" value={`¥${topRevenue.toLocaleString("ja-JP")}`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left text-xs">
              <th className="py-2 pr-2 font-normal">#</th>
              <th className="py-2 pr-3 font-normal">アドバイザー</th>
              <th className="py-2 pr-3 text-right font-normal">担当 referral</th>
              <th className="py-2 pr-3 text-right font-normal">成約</th>
              <th className="py-2 pr-3 text-right font-normal">純売上</th>
              <th className="py-2 font-normal">売上シェア</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, idx) => {
              const rank = row.isUnassigned ? null : idx + 1;
              const pct = maxRevenue > 0 ? (row.netRevenue / maxRevenue) * 100 : 0;
              return (
                <tr
                  key={row.memberId ?? "unassigned"}
                  className={`border-b last:border-b-0 ${row.isUnassigned ? "text-muted-foreground" : ""}`}
                >
                  <td className="text-muted-foreground py-2 pr-2 text-xs tabular-nums">
                    {rank ?? "-"}
                  </td>
                  <td className="py-2 pr-3">
                    {row.isUnassigned ? (
                      <span className="italic">未割当</span>
                    ) : (
                      (row.displayName ?? "(表示名未設定)")
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.referralCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.placementCount}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatYen(row.netRevenue)}</td>
                  <td className="py-2">
                    {row.isUnassigned ? (
                      <span className="text-muted-foreground text-xs">-</span>
                    ) : (
                      <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-2 rounded bg-emerald-500"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {noData && (
          <p className="text-muted-foreground mt-3 text-xs">
            この期間にはまだ実績データがありません。
          </p>
        )}
      </div>
    </>
  );
}

function SummaryTile({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`mt-1 tabular-nums ${emphasize ? "text-lg font-semibold" : "text-base"}`}>
        {value}
      </p>
    </div>
  );
}

function SelfCard({ data, noData }: { data: AdvisorPerformance; noData: boolean }) {
  // advisor 用は必ず 1 行(空でも emptyRowForSelf が入る)
  const me = data.rows[0];
  return (
    <div className="space-y-3">
      <p className="text-sm">{me.displayName ?? "(表示名未設定)"} さんの成績</p>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="担当 referral" value={`${me.referralCount} 件`} />
        <Tile label="成約数" value={`${me.placementCount} 件`} />
        <Tile label="純売上" value={formatYen(me.netRevenue)} emphasize />
      </div>
      {noData && (
        <p className="text-muted-foreground text-xs">この期間にはまだ実績データがありません。</p>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`mt-1 tabular-nums ${emphasize ? "text-lg font-semibold" : "text-base"}`}>
        {value}
      </p>
    </div>
  );
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

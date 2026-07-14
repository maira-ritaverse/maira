import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OfferAcceptanceRate, TimeToFillSummary } from "@/lib/reports/queries";

/**
 * 業界ベンチマーク比較セクション。
 *
 * 世界の転職エージェントが最も重視する 3 指標を業界平均と並べる。
 *  1. 充足日数 (Time to Fill) — 短いほど良い / 業界平均 42 日
 *  2. 内定承諾率 (Offer Acceptance Rate) — 80% 未満は警告 / 業界平均 82%
 *  3. 1 成約あたり獲得コスト (Cost per Hire) — admin 限定 / 業界目安 ¥180,000
 *
 * ・costPerHire が null なら 2 列、あれば 3 列で並べる
 * ・良/警/悪 の 3 段階でアイコン色を切り替える
 */

type CostPerHire = {
  totalCost: number;
  placementCount: number;
  /** cost / count。 count が 0 なら null */
  costPerHire: number | null;
  benchmarkYen: number;
};

type Props = {
  timeToFill: TimeToFillSummary;
  offerAcceptance: OfferAcceptanceRate;
  /** admin 限定。 コスト未入力なら null で渡す */
  costPerHire: CostPerHire | null;
};

export function BenchmarksSection({ timeToFill, offerAcceptance, costPerHire }: Props) {
  const cols = costPerHire ? "md:grid-cols-3" : "md:grid-cols-2";
  return (
    <Card>
      <CardHeader>
        <CardTitle>業界ベンチマーク比較</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          世界の転職エージェントが重視する主要指標を業界平均と並べます
        </p>
      </CardHeader>
      <CardContent>
        <div className={`grid grid-cols-1 gap-4 ${cols}`}>
          <TimeToFillTile data={timeToFill} />
          <OfferAcceptanceTile data={offerAcceptance} />
          {costPerHire && <CostPerHireTile data={costPerHire} />}
        </div>
      </CardContent>
    </Card>
  );
}

function TimeToFillTile({ data }: { data: TimeToFillSummary }) {
  const { averageDays, medianDays, sampleCount, benchmarkDays } = data;
  const status: Status =
    averageDays == null
      ? "empty"
      : averageDays <= benchmarkDays
        ? "good"
        : averageDays <= benchmarkDays * 1.3
          ? "warn"
          : "bad";

  return (
    <Tile
      label="充足日数(応募 → 成約)"
      status={status}
      value={
        averageDays == null ? (
          <EmptyValue />
        ) : (
          <>
            {averageDays}
            <span className="text-muted-foreground ml-1 text-sm font-normal">日</span>
          </>
        )
      }
      hints={[
        medianDays != null ? `中央値:${medianDays} 日` : null,
        `サンプル数:${sampleCount} 件`,
        `業界平均:${benchmarkDays} 日(短いほど良い)`,
      ]}
    />
  );
}

function OfferAcceptanceTile({ data }: { data: OfferAcceptanceRate }) {
  const { rate, acceptedCount, declinedCount, totalDecisions, benchmarkPercent } = data;
  const status: Status =
    rate == null ? "empty" : rate >= benchmarkPercent ? "good" : rate >= 70 ? "warn" : "bad";

  return (
    <Tile
      label="内定承諾率"
      status={status}
      value={
        rate == null ? (
          <EmptyValue />
        ) : (
          <>
            {rate}
            <span className="text-muted-foreground ml-1 text-sm font-normal">%</span>
          </>
        )
      }
      hints={[
        `承諾 ${acceptedCount} 件 / 辞退 ${declinedCount} 件(合計 ${totalDecisions} 件)`,
        `業界平均:${benchmarkPercent}%(80% 未満は要注意)`,
      ]}
    />
  );
}

function CostPerHireTile({ data }: { data: CostPerHire }) {
  const { totalCost, placementCount, costPerHire, benchmarkYen } = data;
  const status: Status =
    costPerHire == null
      ? "empty"
      : costPerHire <= benchmarkYen
        ? "good"
        : costPerHire <= benchmarkYen * 1.5
          ? "warn"
          : "bad";

  return (
    <Tile
      label="1 成約あたり獲得コスト"
      status={status}
      value={
        costPerHire == null ? (
          <EmptyValue />
        ) : (
          <>¥{Math.round(costPerHire).toLocaleString("ja-JP")}</>
        )
      }
      hints={[
        `コスト合計:¥${totalCost.toLocaleString("ja-JP")}`,
        `成約数:${placementCount} 件`,
        `業界目安:¥${benchmarkYen.toLocaleString("ja-JP")}(低いほど良い)`,
      ]}
    />
  );
}

// ============================================
// 共通パーツ
// ============================================

type Status = "good" | "warn" | "bad" | "empty";

function Tile({
  label,
  status,
  value,
  hints,
}: {
  label: string;
  status: Status;
  value: React.ReactNode;
  hints: Array<string | null>;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="text-muted-foreground mt-3 space-y-0.5 text-[11px]">
        {hints
          .filter((h): h is string => h != null)
          .map((h) => (
            <p key={h}>{h}</p>
          ))}
      </div>
    </div>
  );
}

function EmptyValue() {
  return <span className="text-muted-foreground text-base font-normal">データなし</span>;
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "empty") return <Info className="text-muted-foreground size-4" aria-hidden />;
  if (status === "good") return <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="size-4 text-amber-500" aria-hidden />;
  return <AlertTriangle className="size-4 text-red-500" aria-hidden />;
}

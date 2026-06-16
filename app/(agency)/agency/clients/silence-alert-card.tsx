"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import type { ClientRecordWithUpdateBadge } from "@/lib/clients/types";
import { useNow } from "@/lib/agency-tasks/use-now";

type SilenceAlertCardProps = {
  clients: ClientRecordWithUpdateBadge[];
};

/**
 * 沈黙顧客アラートカード(/agency/clients 上部に常設)。
 *
 * 「対応からの経過日数」で 3 段階に分類して件数を表示する。
 * 各バッジクリックで `?silence=<key>` 付きで現在ページに遷移し、
 * ClientsViewTabs がそれを読み取って silenceFilter を自動適用する。
 *
 * 経過の起点は lastInteractionAt ?? createdAt(filter-sort と一致)。
 * 完了 / 見送り状態(status === 'completed' / 'declined')は対象外
 * (終了した顧客の「沈黙」は意味がないため)。
 */
export function SilenceAlertCard({ clients }: SilenceAlertCardProps) {
  const router = useRouter();
  const now = useNow();

  const buckets = useMemo(() => {
    if (!now) return { d14: 0, d30: 0, d60: 0, d90: 0, never: 0 };
    const nowMs = now.getTime();
    const DAY = 24 * 60 * 60 * 1000;
    let d14 = 0;
    let d30 = 0;
    let d60 = 0;
    let d90 = 0;
    let never = 0;
    for (const c of clients) {
      // 終了顧客は除外(CRM では履歴として残るが「沈黙アラート」の対象ではない)
      if (c.status === "completed" || c.status === "declined") continue;
      if (c.lastInteractionAt === null) never += 1;
      const baseIso = c.lastInteractionAt ?? c.createdAt;
      const baseMs = Date.parse(baseIso);
      if (Number.isNaN(baseMs)) continue;
      const elapsed = nowMs - baseMs;
      if (elapsed >= 90 * DAY) d90 += 1;
      if (elapsed >= 60 * DAY) d60 += 1;
      if (elapsed >= 30 * DAY) d30 += 1;
      if (elapsed >= 14 * DAY) d14 += 1;
    }
    return { d14, d30, d60, d90, never };
  }, [clients, now]);

  const navigate = (silenceKey: string) => {
    router.push(`/agency/clients?silence=${silenceKey}`);
  };

  // 全件 0 件なら表示しない(画面を圧迫しないため)
  const hasAny =
    buckets.d14 > 0 || buckets.d30 > 0 || buckets.d60 > 0 || buckets.d90 > 0 || buckets.never > 0;
  if (!hasAny) return null;

  return (
    <Card className="space-y-3 border-amber-200 bg-amber-50/30 p-4 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-amber-600 dark:text-amber-400">
          ⚠
        </span>
        <h2 className="text-sm font-semibold">対応が止まっている顧客</h2>
        <span className="text-muted-foreground text-xs">(完了 / 見送り は除外)</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <AlertChip count={buckets.d14} label="14日以上対応なし" onClick={() => navigate("14d")} />
        <AlertChip
          count={buckets.d30}
          label="30日以上対応なし"
          onClick={() => navigate("30d")}
          tone="medium"
        />
        <AlertChip
          count={buckets.d60}
          label="60日以上対応なし"
          onClick={() => navigate("60d")}
          tone="strong"
        />
        <AlertChip
          count={buckets.d90}
          label="90日以上対応なし"
          onClick={() => navigate("90d")}
          tone="strong"
        />
        <AlertChip
          count={buckets.never}
          label="一度も対応なし"
          onClick={() => navigate("never")}
          tone="muted"
        />
      </div>
    </Card>
  );
}

type AlertChipProps = {
  count: number;
  label: string;
  onClick: () => void;
  tone?: "light" | "medium" | "strong" | "muted";
};

const TONE_CLASSES: Record<NonNullable<AlertChipProps["tone"]>, string> = {
  light: "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-200",
  medium:
    "bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-900/50 dark:text-orange-200",
  strong: "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-200",
  muted: "bg-muted text-muted-foreground hover:bg-accent",
};

function AlertChip({ count, label, onClick, tone = "light" }: AlertChipProps) {
  // 0 件のチップは出さない(ノイズ削減)
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${TONE_CLASSES[tone]}`}
    >
      <span>{label}</span>
      <span className="font-bold tabular-nums">{count}</span>
    </button>
  );
}

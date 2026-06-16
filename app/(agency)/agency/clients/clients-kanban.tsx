"use client";

import { useMemo, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";

import {
  clientStatusLabels,
  type ClientRecordWithUpdateBadge,
  type ClientStatus,
} from "@/lib/clients/types";
import { getDueStatus } from "@/lib/agency-tasks/due-status";
import { useNow } from "@/lib/agency-tasks/use-now";

type ClientsKanbanProps = {
  /** フィルタ + ソート済みのクライアント一覧(親 ClientsViewTabs から受け取る) */
  clients: ClientRecordWithUpdateBadge[];
};

// カンバンの列順。営業フロー(初回 → 求人紹介 → 選考 → 内定 → 完了 / 見送り)に沿う。
// completed と declined は終端カラムとして右端に並べる。
const STATUS_COLUMNS: ClientStatus[] = [
  "initial_meeting",
  "job_matching",
  "in_screening",
  "offer",
  "completed",
  "declined",
];

// 各列の色トーン(対応状況の重みづけ)。
// 中盤(matching/screening)を中立、内定を緑、完了を青、見送りをグレー寄せ。
const COLUMN_TINT: Record<ClientStatus, string> = {
  initial_meeting: "border-t-slate-400 dark:border-t-slate-600",
  job_matching: "border-t-amber-400 dark:border-t-amber-600",
  in_screening: "border-t-purple-400 dark:border-t-purple-600",
  offer: "border-t-emerald-400 dark:border-t-emerald-600",
  completed: "border-t-blue-400 dark:border-t-blue-600",
  declined: "border-t-zinc-400 dark:border-t-zinc-600",
};

/**
 * クライアントカンバンビュー(ステータス列ごとにカードを並べてドラッグ移動)。
 *
 * 設計方針:
 * - 列は ClientStatus enum と 1 対 1。完了 / 見送りも明示的に列として出すことで
 *   「終わった顧客の在庫」が CRM 上で常に見える(永続管理の意図に沿う)。
 * - ドラッグ&ドロップは HTML5 native(外部依存ゼロ)。
 * - 楽観更新:ドロップ瞬時にカードを移動 → PATCH 成功なら router.refresh、
 *   失敗ならロールバック + アラート表示。
 * - カードクリックで詳細遷移(button 要素ではなく div + onClick + role)。
 */
export function ClientsKanban({ clients }: ClientsKanbanProps) {
  const router = useRouter();
  const now = useNow();

  // 楽観更新用の override(id → 移動先 status)。
  // PATCH 成功 → router.refresh → 親から新しい clients が来るので、ここをクリア。
  // 失敗 → ここから当該 id を削除して元に戻す。
  const [overrides, setOverrides] = useState<Record<string, ClientStatus>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<ClientStatus | null>(null);

  // 表示用に override を適用してから status でグルーピング。
  // override は「いま操作中」分しか入らないので、props 変化時に勝手に消える設計。
  const grouped = useMemo(() => {
    const map = new Map<ClientStatus, ClientRecordWithUpdateBadge[]>();
    for (const s of STATUS_COLUMNS) map.set(s, []);
    for (const c of clients) {
      const effectiveStatus = overrides[c.id] ?? c.status;
      map.get(effectiveStatus)?.push(c);
    }
    return map;
  }, [clients, overrides]);

  const handleDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setHoverColumn(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, column: ClientStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverColumn !== column) setHoverColumn(column);
  };

  const handleDragLeave = (column: ClientStatus) => {
    if (hoverColumn === column) setHoverColumn(null);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>, targetStatus: ClientStatus) => {
    e.preventDefault();
    setHoverColumn(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;

    const client = clients.find((c) => c.id === id);
    if (!client) return;
    const currentStatus = overrides[id] ?? client.status;
    if (currentStatus === targetStatus) return;

    // 楽観適用 + ペンディングフラグ
    setOverrides((prev) => ({ ...prev, [id]: targetStatus }));
    setPendingIds((prev) => new Set(prev).add(id));

    try {
      const res = await fetch(`/api/agency/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
      // 反映を待ってから override を解除しても良いが、router.refresh は
      // 親の clients を更新するので、ここでクリアして OK(props が更新されたら
      // overrides の指す状態と一致するため画面は揺れない)。
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      // ロールバック
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const message = err instanceof Error ? err.message : "不明なエラー";
      alert(`ステータス更新に失敗しました: ${message}`);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_COLUMNS.map((status) => {
        const items = grouped.get(status) ?? [];
        const isHovered = hoverColumn === status;
        return (
          <div
            key={status}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={() => handleDragLeave(status)}
            onDrop={(e) => handleDrop(e, status)}
            className={`flex w-72 shrink-0 flex-col rounded-xl border-t-4 ${COLUMN_TINT[status]} bg-muted/30 transition-colors ${
              isHovered ? "bg-accent/40 ring-primary ring-2" : ""
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-semibold">{clientStatusLabels[status]}</span>
              <span className="text-muted-foreground bg-background rounded-full px-2 py-0.5 text-xs tabular-nums">
                {items.length}
              </span>
            </div>
            <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-3">
              {items.length === 0 ? (
                <div className="text-muted-foreground py-4 text-center text-xs">該当なし</div>
              ) : (
                items.map((client) => (
                  <KanbanCard
                    key={client.id}
                    client={client}
                    now={now}
                    isPending={pendingIds.has(client.id)}
                    isDragging={draggingId === client.id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onClick={() => router.push(`/agency/clients/${client.id}`)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type KanbanCardProps = {
  client: ClientRecordWithUpdateBadge;
  now: Date | null;
  isPending: boolean;
  isDragging: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragEnd: () => void;
  onClick: () => void;
};

function KanbanCard({
  client,
  now,
  isPending,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: KanbanCardProps) {
  // 期限超過 / 間近の集計(テーブル版と同じロジック)
  let overdue = 0;
  let soon = 0;
  if (now) {
    for (const due of client.pendingDueAts) {
      const s = getDueStatus(due, now, false);
      if (s === "overdue") overdue += 1;
      else if (s === "soon") soon += 1;
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStart(e, client.id)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`bg-background hover:border-primary cursor-grab rounded-lg border p-2.5 text-sm shadow-sm transition active:cursor-grabbing ${
        isDragging ? "opacity-50" : ""
      } ${isPending ? "pointer-events-none animate-pulse" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{client.name}</div>
          {client.nameKana && (
            <div className="text-muted-foreground truncate text-xs">{client.nameKana}</div>
          )}
        </div>
      </div>
      {/* バッジ群:期限超過 → 間近 → 更新あり → 他社利用 の順 */}
      <div className="mt-2 flex flex-wrap gap-1">
        {overdue > 0 && (
          <span className="inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            超過 {overdue}
          </span>
        )}
        {soon > 0 && (
          <span className="inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            間近 {soon}
          </span>
        )}
        {client.hasUnreadUpdate && (
          <span className="inline-block rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            更新
          </span>
        )}
        {client.hasOtherAgencyStatus && (
          <span className="inline-block rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
            ⚠ 他社
          </span>
        )}
        {client.referralBreakdown.total > 0 && (
          <span className="bg-muted text-muted-foreground inline-block rounded-full px-1.5 py-0.5 text-[10px]">
            応募 {client.referralBreakdown.total}
          </span>
        )}
      </div>
      <div className="text-muted-foreground mt-2 flex items-center justify-between text-[11px]">
        <span className="truncate">{client.assigneeName ?? "未割当"}</span>
        <span className="whitespace-nowrap">
          {client.intakeDate
            ? new Date(client.intakeDate).toLocaleDateString("ja-JP")
            : new Date(client.createdAt).toLocaleDateString("ja-JP")}
        </span>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  clientEmploymentTypeLabels,
  clientLinkStatusLabels,
  clientStatusLabels,
  type ClientRecordWithUpdateBadge,
  type ReferralBreakdown,
} from "@/lib/clients/types";
import {
  COLUMN_LABELS,
  SORTABLE_COLUMNS,
  defaultColumnConfig,
  reorderColumnTo,
  type ColumnConfig,
  type ColumnId,
} from "@/lib/clients/column-config";
import { getDueStatus } from "@/lib/agency-tasks/due-status";
import { useNow } from "@/lib/agency-tasks/use-now";
import type { SortColumn, SortDirection } from "@/lib/clients/filter-sort";
import {
  getReferralStatusConfig,
  referralStatusConfig,
  type ReferralStatus,
} from "@/lib/referrals/types";

import { visibleColumns } from "./column-config-modal";

type ClientsTableProps = {
  /**
   * 既にフィルタ + ソート済みのクライアント一覧。
   * フィルタ / ソート状態とロジックは親(ClientsViewTabs)に集約し、
   * ClientsTable は描画専任にする(カンバンビューと共通の絞り込み体験のため)。
   */
  clients: ClientRecordWithUpdateBadge[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onToggleSort: (column: SortColumn) => void;
  /** 列の並び順 + 表示設定。未指定はデフォルト全表示。 */
  columnConfig?: ColumnConfig;
  /** ヘッダ DnD による並び替えを反映するコールバック(未指定なら DnD 無効) */
  onColumnConfigChange?: (next: ColumnConfig) => void;
  /** 列設定モーダルを開くコールバック(表示/非表示の切替用) */
  onOpenColumnConfig?: () => void;
  /** 一括操作:選択中の ID 群と toggle/all コールバック。null/未指定なら選択 UI を出さない。 */
  selectedIds?: Set<string>;
  onToggleSelectId?: (id: string) => void;
  onToggleSelectAll?: () => void;
};

// 応募状況バッジ用の短ラベル(セル幅を圧迫しないように)。
const referralStatusCompactLabel: Record<ReferralStatus, string> = {
  planned: "予定",
  recommended: "推薦",
  screening: "書類",
  interview: "面接",
  offer: "内定",
  joined: "入社",
  declined: "見送",
};

/**
 * 1クライアントの pendingDueAts から、期限超過/間近の件数を集計する。
 * 判定ロジックは詳細画面の色分けと共通(getDueStatus)。
 * now=null(マウント前)は両方 0 を返して、初回 SSR と差分が出ないようにする。
 */
function countByDueStatus(
  pendingDueAts: (string | null)[],
  now: Date | null,
): { overdue: number; soon: number } {
  if (!now) return { overdue: 0, soon: 0 };
  let overdue = 0;
  let soon = 0;
  for (const due of pendingDueAts) {
    const s = getDueStatus(due, now, false);
    if (s === "overdue") overdue += 1;
    else if (s === "soon") soon += 1;
  }
  return { overdue, soon };
}

/**
 * クライアント一覧のテーブル表示(presentational)。
 *
 * 列の並び順 / 表示は columnConfig で制御。各列のセル renderer は CELL_RENDERERS に集約。
 */
export function ClientsTable({
  clients,
  sortColumn,
  sortDirection,
  onToggleSort,
  columnConfig,
  onColumnConfigChange,
  onOpenColumnConfig,
  selectedIds,
  onToggleSelectId,
  onToggleSelectAll,
}: ClientsTableProps) {
  const router = useRouter();
  const now = useNow();
  const selectionEnabled = selectedIds !== undefined;
  const allChecked =
    selectionEnabled && clients.length > 0 && clients.every((c) => selectedIds!.has(c.id));
  const someChecked =
    selectionEnabled && !allChecked && clients.some((c) => selectedIds!.has(c.id));

  const config = columnConfig ?? defaultColumnConfig();
  const visible = visibleColumns(config);

  // ヘッダ DnD の状態
  const [dragColIdx, setDragColIdx] = useState<number | null>(null);
  const [hoverColIdx, setHoverColIdx] = useState<number | null>(null);
  const dndEnabled = onColumnConfigChange !== undefined;

  const sortArrow = (col: SortColumn): string => {
    if (sortColumn !== col) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };
  const isSortable = (id: ColumnId): id is SortColumn =>
    (SORTABLE_COLUMNS as readonly string[]).includes(id);

  // ヘッダ DnD ハンドラ。visible 配列上の index と config.order の index を変換して
  // reorderColumnTo に渡す(非表示列を含む全体の並びで操作するため)。
  const handleHeaderDragStart =
    (visibleIdx: number) => (e: React.DragEvent<HTMLTableCellElement>) => {
      if (!dndEnabled) return;
      setDragColIdx(visibleIdx);
      e.dataTransfer.setData("text/plain", String(visibleIdx));
      e.dataTransfer.effectAllowed = "move";
    };
  const handleHeaderDragOver =
    (visibleIdx: number) => (e: React.DragEvent<HTMLTableCellElement>) => {
      if (!dndEnabled || dragColIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (hoverColIdx !== visibleIdx) setHoverColIdx(visibleIdx);
    };
  const handleHeaderDrop = (visibleIdx: number) => (e: React.DragEvent<HTMLTableCellElement>) => {
    if (!dndEnabled || dragColIdx === null) return;
    e.preventDefault();
    // visible 配列上の (dragColIdx, visibleIdx) を、config.order 上の index に変換
    const fromId = visible[dragColIdx];
    const toId = visible[visibleIdx];
    const fromOrderIdx = config.order.indexOf(fromId);
    const toOrderIdx = config.order.indexOf(toId);
    if (fromOrderIdx >= 0 && toOrderIdx >= 0) {
      onColumnConfigChange!(reorderColumnTo(config, fromOrderIdx, toOrderIdx));
    }
    setDragColIdx(null);
    setHoverColIdx(null);
  };
  const handleHeaderDragEnd = () => {
    setDragColIdx(null);
    setHoverColIdx(null);
  };

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span>💡 列見出しをドラッグして並び替え、クリックでソート</span>
        {onOpenColumnConfig && (
          <Button size="sm" variant="ghost" onClick={onOpenColumnConfig}>
            ⚙ 列の表示
          </Button>
        )}
      </div>
      {/*
        Excel ライクなテーブル:
          - 横スクロール可能(overflow-x-auto)
          - 各セルに右側罫線(border-r)+ 行罫線(TableRow デフォルトの border-b)で格子状
          - ヘッダは muted 背景 + bold + 罫線で立体感
          - 最後の列の右罫線は last:border-r-0 で消す(枠線と二重にならないように)
      */}
      <div className="ring-foreground/10 overflow-x-auto rounded-md ring-1">
        <Table className="border-collapse">
          <TableHeader className="bg-muted/40">
            <TableRow className="border-b">
              {selectionEnabled && (
                <TableHead className="w-10 border-r">
                  <input
                    type="checkbox"
                    aria-label="全選択"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked;
                    }}
                    onChange={onToggleSelectAll}
                    className="cursor-pointer"
                  />
                </TableHead>
              )}
              {visible.map((id, vIdx) => {
                const isDragging = dragColIdx === vIdx;
                const isHoverTarget =
                  hoverColIdx === vIdx && dragColIdx !== null && dragColIdx !== vIdx;
                // ホバー先列の境界線:ドラッグ元より右なら右側を、左なら左側を強調
                // 通常の border-r とは別の太い線(emerald)で「ここに落ちる」を示す
                const indicator = isHoverTarget
                  ? dragColIdx! < vIdx
                    ? "shadow-[inset_-3px_0_0_0_rgba(16,185,129,1)]"
                    : "shadow-[inset_3px_0_0_0_rgba(16,185,129,1)]"
                  : "";
                const sortable = isSortable(id);
                return (
                  <TableHead
                    key={id}
                    draggable={dndEnabled}
                    onDragStart={handleHeaderDragStart(vIdx)}
                    onDragOver={handleHeaderDragOver(vIdx)}
                    onDrop={handleHeaderDrop(vIdx)}
                    onDragEnd={handleHeaderDragEnd}
                    onClick={sortable ? () => onToggleSort(id) : undefined}
                    className={`text-foreground border-r font-semibold whitespace-nowrap transition-colors select-none last:border-r-0 ${
                      dndEnabled ? "cursor-grab active:cursor-grabbing" : ""
                    } ${sortable && !dndEnabled ? "cursor-pointer" : ""} ${
                      isDragging ? "opacity-50" : ""
                    } ${indicator}`}
                    title={
                      dndEnabled
                        ? sortable
                          ? "ドラッグで並び替え / クリックでソート"
                          : "ドラッグで並び替え"
                        : sortable
                          ? "クリックでソート"
                          : undefined
                    }
                  >
                    {COLUMN_LABELS[id]}
                    {sortable && sortArrow(id)}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visible.length + (selectionEnabled ? 1 : 0)}
                  className="text-muted-foreground py-8 text-center"
                >
                  該当するクライアントがいません
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => {
                const { overdue, soon } = countByDueStatus(client.pendingDueAts, now);
                const isSelected = selectionEnabled && selectedIds!.has(client.id);
                return (
                  <TableRow
                    key={client.id}
                    className={`hover:bg-accent cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
                    onClick={() => router.push(`/agency/clients/${client.id}`)}
                  >
                    {selectionEnabled && (
                      <TableCell
                        className="border-r"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${client.name} を選択`}
                          checked={isSelected ?? false}
                          onChange={() => onToggleSelectId?.(client.id)}
                          className="cursor-pointer"
                        />
                      </TableCell>
                    )}
                    {visible.map((id) => (
                      <TableCell
                        key={id}
                        className={
                          // 各セルに右罫線 + 最後の列だけ消す(枠線との二重防止)
                          // 名前列は強調(font-medium)、他は muted(罫線 + 余白の見やすさ優先)
                          // whitespace-nowrap で「松田/太郎」のような途中改行を防ぐ。
                          // 一覧は overflow-x-auto で横スクロールに切り替わる前提。
                          `border-r whitespace-nowrap last:border-r-0 ${
                            id === "name" ? "font-medium" : "text-muted-foreground"
                          }`
                        }
                      >
                        {renderCell(id, client, { overdue, soon })}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * 各列の cell 描画ロジック。
 * 既存の table セルから抜き出して 1 つの switch に集約。
 */
function renderCell(
  id: ColumnId,
  client: ClientRecordWithUpdateBadge,
  due: { overdue: number; soon: number },
): React.ReactNode {
  switch (id) {
    case "name":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span>{client.name}</span>
          {due.overdue > 0 && (
            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-950 dark:text-red-300">
              期限超過 {due.overdue}件
            </span>
          )}
          {due.soon > 0 && (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              まもなく {due.soon}件
            </span>
          )}
          {client.hasUnreadUpdate && (
            <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              更新あり
            </span>
          )}
          {client.hasOtherAgencyStatus && (
            <span
              className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-purple-700 dark:bg-purple-950 dark:text-purple-300"
              title="他社エージェント利用状況が記録されています(詳細は詳細画面で)"
            >
              ⚠ 他社利用中
            </span>
          )}
        </div>
      );
    case "nameKana":
      return client.nameKana ?? "—";
    case "email":
      return client.email;
    case "phone":
      return client.phone ?? "—";
    case "prefecture":
      return client.prefecture ?? "—";
    case "employmentType":
      return client.currentEmploymentType
        ? clientEmploymentTypeLabels[client.currentEmploymentType]
        : "—";
    case "status":
      return (
        <span className="bg-muted inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
          {clientStatusLabels[client.status]}
        </span>
      );
    case "applicationStatus":
      return <ReferralBreakdownBadges breakdown={client.referralBreakdown} />;
    case "linkStatus":
      return (
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
            client.linkStatus === "linked"
              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
              : client.linkStatus === "revoke_requested"
                ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {clientLinkStatusLabels[client.linkStatus]}
        </span>
      );
    case "maStatus":
      return client.emailDistributionEnabled ? (
        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs whitespace-nowrap text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          許可
        </span>
      ) : (
        <span className="bg-muted text-muted-foreground inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
          停止
        </span>
      );
    case "assignee":
      return client.assigneeName ?? "未割当";
    case "nextMeeting": {
      if (!client.nextMeetingAt) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      const d = new Date(client.nextMeetingAt);
      const isToday = d.toDateString() === new Date().toDateString();
      return (
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
            isToday
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          }`}
          title={d.toLocaleString("ja-JP")}
        >
          {d.toLocaleString("ja-JP", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      );
    }
    case "receivedAt":
      return client.intakeDate ? new Date(client.intakeDate).toLocaleDateString("ja-JP") : "—";
    case "createdAt":
      return new Date(client.createdAt).toLocaleDateString("ja-JP");
  }
}

/**
 * 応募状況バッジ群(列セル)
 *
 * referral 段階別の件数を「ある段階だけ」横に並べる(0 件は出さない)。
 * 並び順は referralStatusConfig の order に従い、本筋(planned→joined)を先に、
 * declined は末尾 + 薄色(opacity-60)で控えめに表示する。
 */
function ReferralBreakdownBadges({ breakdown }: { breakdown: ReferralBreakdown }) {
  if (breakdown.total === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const ordered = [...referralStatusConfig].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ordered.map((cfg) => {
        const count = breakdown.byStatus[cfg.value];
        if (!count) return null;
        const compact = referralStatusCompactLabel[cfg.value];
        const config = getReferralStatusConfig(cfg.value);
        const dimmed = cfg.value === "declined" ? "opacity-60" : "";
        return (
          <span
            key={cfg.value}
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${config.className} ${dimmed}`}
          >
            <span>{compact}</span>
            <span className="tabular-nums">{count}</span>
          </span>
        );
      })}
    </div>
  );
}

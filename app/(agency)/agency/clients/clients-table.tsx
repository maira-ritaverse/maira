"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  clientLinkStatusLabels,
  clientStatusLabels,
  type ClientRecordWithAssigneeAndDues,
  type ClientStatus,
} from "@/lib/clients/types";
import { getDueStatus } from "@/lib/agency-tasks/due-status";
import { useNow } from "@/lib/agency-tasks/use-now";

type SortColumn = "name" | "status" | "createdAt";
type SortDirection = "asc" | "desc";
type StatusFilter = ClientStatus | "all";

type ClientsTableProps = {
  clients: ClientRecordWithAssigneeAndDues[];
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
 * クライアント一覧のテーブル表示(クライアントコンポーネント)
 *
 * - ソート/フィルタ/検索はすべてクライアント側(JS)で処理。
 *   想定データ量が少ない前提で、サーバー往復を減らして UX を優先。
 *   データ量が増えた場合はサーバー側ページネーション・絞り込みに移行する。
 * - 行クリックで /agency/clients/[id] に遷移する。
 */
export function ClientsTable({ clients }: ClientsTableProps) {
  const router = useRouter();
  const [sortColumn, setSortColumn] = useState<SortColumn>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // 期限バッジ用の現在時刻(useSyncExternalStore で SSR null → マウント後 Date)
  const now = useNow();

  const filteredSorted = useMemo(() => {
    let result = clients;

    // 検索(氏名 or メールに部分一致、大文字小文字無視)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
      );
    }

    // ステータス絞り込み
    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }

    // ソート(immutable: 元配列を破壊しないため slice してから sort)
    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortColumn === "name") {
        // 日本語の自然順でソート(漢字/かな対応)
        cmp = a.name.localeCompare(b.name, "ja");
      } else if (sortColumn === "status") {
        cmp = a.status.localeCompare(b.status);
      } else {
        cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [clients, searchQuery, statusFilter, sortColumn, sortDirection]);

  const toggleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

  const sortArrow = (col: SortColumn): string => {
    if (sortColumn !== col) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="space-y-4">
      {/* 検索・フィルタ行 */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="氏名・メールで検索"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="border-input bg-background rounded-lg border px-3 py-1.5 text-sm"
        >
          <option value="all">すべてのステータス</option>
          {Object.entries(clientStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-sm">{filteredSorted.length}件</span>
      </div>

      {/* テーブル */}
      <div className="ring-foreground/10 rounded-xl ring-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("name")}>
                氏名{sortArrow("name")}
              </TableHead>
              <TableHead>メール</TableHead>
              <TableHead>電話</TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort("status")}
              >
                ステータス{sortArrow("status")}
              </TableHead>
              <TableHead>連携</TableHead>
              <TableHead>担当者</TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort("createdAt")}
              >
                登録日{sortArrow("createdAt")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  該当するクライアントがいません
                </TableCell>
              </TableRow>
            ) : (
              filteredSorted.map((client) => {
                const { overdue, soon } = countByDueStatus(client.pendingDueAts, now);
                return (
                  <TableRow
                    key={client.id}
                    className="hover:bg-accent cursor-pointer"
                    onClick={() => router.push(`/agency/clients/${client.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{client.name}</span>
                        {/* 期限超過・間近のバッジ。詳細画面のタスク色分けと同じトーン */}
                        {overdue > 0 && (
                          <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-700 dark:bg-red-950 dark:text-red-300">
                            期限超過 {overdue}件
                          </span>
                        )}
                        {soon > 0 && (
                          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            まもなく {soon}件
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{client.email}</TableCell>
                    <TableCell className="text-muted-foreground">{client.phone ?? "—"}</TableCell>
                    <TableCell>
                      <span className="bg-muted inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                        {clientStatusLabels[client.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
                          client.linkStatus === "linked"
                            ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {clientLinkStatusLabels[client.linkStatus]}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.assigneeName ?? "未割当"}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {new Date(client.createdAt).toLocaleDateString("ja-JP")}
                    </TableCell>
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

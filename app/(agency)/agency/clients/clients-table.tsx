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
  type ClientRecordWithUpdateBadge,
  type ClientStatus,
  type ReferralBreakdown,
} from "@/lib/clients/types";
import {
  getReferralStatusConfig,
  referralStatusConfig,
  type ReferralStatus,
} from "@/lib/referrals/types";
import { getDueStatus } from "@/lib/agency-tasks/due-status";
import { useNow } from "@/lib/agency-tasks/use-now";

type SortColumn = "name" | "status" | "createdAt";
type SortDirection = "asc" | "desc";
type StatusFilter = ClientStatus | "all";

type ClientsTableProps = {
  clients: ClientRecordWithUpdateBadge[];
};

// 応募状況バッジ用の短ラベル(セル幅を圧迫しないように)。
// 完全な日本語ラベルは referralStatusConfig 側にあるが、
// 一覧の小バッジ表示では「書類選考」のような長めの語が並ぶと崩れるため、
// 一覧用だけのコンパクトラベルをここで持つ。
// 共通化したくなったら referrals/types に compactLabel として持ち上げる。
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
          <option value="all">すべての対応状況</option>
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
                対応状況{sortArrow("status")}
              </TableHead>
              <TableHead>応募状況</TableHead>
              <TableHead>連携</TableHead>
              <TableHead>MA配信</TableHead>
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
                <TableCell colSpan={9} className="text-muted-foreground py-8 text-center">
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
                        {/* 本人データ(career_profile/resume/cv)の更新を、自分が前回見て
                            以降に見ていない場合に出す。詳細を開いた次回ロードで消える。
                            色はタスク超過(赤)・間近(黄)と被らない青系にして、原因の違い
                            (エージェント都合 vs 求職者由来)を視覚的に区別する。 */}
                        {client.hasUnreadUpdate && (
                          <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            更新あり
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
                      <ReferralBreakdownBadges breakdown={client.referralBreakdown} />
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    {/* MA 配信抑制フラグの表示。許可=緑、停止=グレーで一目で区別する。
                        実装的にはこの列は E (20260615000005) 以降のレコードでのみ
                        意味のある値が入る(default true)。 */}
                    <TableCell>
                      {client.emailDistributionEnabled ? (
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs whitespace-nowrap text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          許可
                        </span>
                      ) : (
                        <span className="bg-muted text-muted-foreground inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                          停止
                        </span>
                      )}
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

/**
 * 応募状況バッジ群(列セル)
 *
 * referral 段階別の件数を「ある段階だけ」横に並べる(0 件は出さない)。
 * 並び順は referralStatusConfig の order に従い、本筋(planned→joined)を先に、
 * declined は末尾 + 薄色(opacity-60)で控えめに表示する。
 *
 * 行クリックで詳細遷移するので、バッジ自体はクリック制御を持たない
 * (見た目だけのインジケータ)。
 * referral が 0 件のクライアントは「—」を控えめに出すだけにして、
 * 列が極端に空にならないようにする。
 */
function ReferralBreakdownBadges({ breakdown }: { breakdown: ReferralBreakdown }) {
  if (breakdown.total === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  // referralStatusConfig は order を持つので、それに従って並べる(declined は 99 で末尾)。
  // byStatus はキーごとに件数。0 件のキーは持たない契約。
  const ordered = [...referralStatusConfig].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {ordered.map((cfg) => {
        const count = breakdown.byStatus[cfg.value];
        if (!count) return null;
        const compact = referralStatusCompactLabel[cfg.value];
        const config = getReferralStatusConfig(cfg.value);
        // declined は注意を引きすぎないよう opacity を下げる(色は status 別配色のまま)。
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

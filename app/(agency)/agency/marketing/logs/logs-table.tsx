"use client";

import { Fragment, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SendLog } from "@/lib/ma/types";

/**
 * 送信履歴テーブル(クライアント)
 *
 * 上部にフィルタ(シナリオ・ステータス)、テーブルで一覧表示。
 * 各行クリックで詳細パネル(件名・本文・エラー全文)を展開。
 *
 * 暗号化されていた subject/body は親(サーバーコンポーネント)側で復号済み。
 * 「件名のみ」「失敗時のエラーメッセージ」をテーブルに、「本文全文」を展開時に出す。
 */
export type LogsTableProps = {
  logs: SendLog[];
  scenarioNameById: Record<string, string>;
  filterOptions: { id: string; name: string }[];
  currentScenarioId?: string;
  currentStatus?: "sent" | "failed" | "skipped";
  // YYYY-MM-DD 形式の日付フィルタ。サーバー側で時刻補完して使う(00:00 〜 23:59:59)。
  currentFrom?: string;
  currentTo?: string;
  // 1 始まりのページ番号と、次ページがあるかどうか(サーバー側で limit+1 を取って判定済み)。
  currentPage: number;
  hasNextPage: boolean;
};

const STATUS_LABELS: Record<SendLog["status"], string> = {
  sent: "成功",
  failed: "失敗",
  skipped: "スキップ",
};

const STATUS_COLORS: Record<SendLog["status"], string> = {
  sent: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  skipped: "bg-slate-100 text-slate-700",
};

export function LogsTable({
  logs,
  scenarioNameById,
  filterOptions,
  currentScenarioId,
  currentStatus,
  currentFrom,
  currentTo,
  currentPage,
  hasNextPage,
}: LogsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  function updateFilter(key: "scenario" | "status" | "from" | "to", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // フィルタ変更時はページを 1 にリセット(2 ページ目で絞り込み変えて結果が空、を防ぐ)
    params.delete("page");
    router.push(`/agency/marketing/logs?${params.toString()}`);
  }

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) params.delete("page");
    else params.set("page", String(page));
    router.push(`/agency/marketing/logs?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="scenarioFilter" className="text-sm font-medium">
            シナリオ:
          </label>
          <select
            id="scenarioFilter"
            value={currentScenarioId ?? ""}
            onChange={(e) => updateFilter("scenario", e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="">すべて</option>
            {filterOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="statusFilter" className="text-sm font-medium">
            ステータス:
          </label>
          <select
            id="statusFilter"
            value={currentStatus ?? ""}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            <option value="">すべて</option>
            <option value="sent">成功</option>
            <option value="failed">失敗</option>
            <option value="skipped">スキップ</option>
          </select>
        </div>
        {/* 日付範囲フィルタ。YYYY-MM-DD を URL クエリに直接入れる(サーバー側で時刻補完)。
            「from のみ」「to のみ」も許容(片方だけ指定して以降/以前を絞れる)。 */}
        <div className="flex items-center gap-2">
          <label htmlFor="dateFrom" className="text-sm font-medium">
            期間:
          </label>
          <input
            id="dateFrom"
            type="date"
            value={currentFrom ?? ""}
            onChange={(e) => updateFilter("from", e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          />
          <span className="text-muted-foreground text-xs">〜</span>
          <input
            id="dateTo"
            type="date"
            value={currentTo ?? ""}
            onChange={(e) => updateFilter("to", e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          />
        </div>
        {(currentScenarioId || currentStatus || currentFrom || currentTo) && (
          <Button variant="ghost" size="sm" onClick={() => router.push("/agency/marketing/logs")}>
            フィルタ解除
          </Button>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          {logs.length} 件 / ページ {currentPage}
        </span>
        {/* CSV エクスポート:現在の filter を引き継いだ URL でダウンロード。
            復号は API ルート側で実施(キーは Web セッションを使うため Cookie 必須)。 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const qs = new URLSearchParams();
            if (currentScenarioId) qs.set("scenario", currentScenarioId);
            if (currentStatus) qs.set("status", currentStatus);
            if (currentFrom) qs.set("from", currentFrom);
            if (currentTo) qs.set("to", currentTo);
            const query = qs.toString();
            window.location.href = `/api/agency/ma/logs/export${query ? `?${query}` : ""}`;
          }}
          disabled={logs.length === 0}
        >
          CSV ダウンロード
        </Button>
      </div>

      {/* テーブル */}
      {logs.length === 0 ? (
        <EmptyState
          icon="📭"
          title="送信履歴がまだありません"
          description="MA 配信や「テスト送信」を実行するとここに表示されます"
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-35">送信日時</TableHead>
                <TableHead>シナリオ</TableHead>
                <TableHead>受信者</TableHead>
                <TableHead>件名</TableHead>
                <TableHead className="w-20">状態</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const isOpen = expanded === log.id;
                const scenarioName = scenarioNameById[log.scenarioId] ?? "(削除済シナリオ)";
                return (
                  <Fragment key={log.id}>
                    <TableRow
                      className="hover:bg-accent cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                    >
                      <TableCell className="text-xs">
                        {new Date(log.sentAt).toLocaleString("ja-JP", {
                          year: "2-digit",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-sm">{scenarioName}</TableCell>
                      <TableCell className="font-mono text-xs">{log.recipientEmail}</TableCell>
                      <TableCell className="max-w-md truncate text-sm">{log.subject}</TableCell>
                      <TableCell>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[log.status]}`}
                        >
                          {STATUS_LABELS[log.status]}
                        </span>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <div className="space-y-2 p-2 text-sm">
                            <div>
                              <p className="text-muted-foreground text-xs font-semibold">本文</p>
                              <pre className="bg-background mt-1 rounded border p-2 font-sans wrap-break-word whitespace-pre-wrap">
                                {log.body || "(空)"}
                              </pre>
                            </div>
                            {log.errorMessage && (
                              <div>
                                <p className="text-muted-foreground text-xs font-semibold">
                                  エラー
                                </p>
                                <pre className="mt-1 rounded border border-red-200 bg-red-50 p-2 text-xs wrap-break-word whitespace-pre-wrap text-red-800">
                                  {log.errorMessage}
                                </pre>
                              </div>
                            )}
                            {log.resendMessageId && (
                              <p className="text-muted-foreground text-xs">
                                Resend ID: <span className="font-mono">{log.resendMessageId}</span>
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ページネーション。
          前ページボタンは currentPage>1 のときだけ表示、次ページは hasNextPage で判定。
          ボタン両方とも出ないケース(1 ページのみで完結)は枠ごと出さない。 */}
      {(currentPage > 1 || hasNextPage) && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            ← 前のページ
          </Button>
          <span className="text-muted-foreground text-xs">ページ {currentPage}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={!hasNextPage}
          >
            次のページ →
          </Button>
        </div>
      )}
    </div>
  );
}

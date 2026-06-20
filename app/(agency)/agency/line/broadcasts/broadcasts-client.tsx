"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 一斉配信 作成 + 履歴 表示
 *
 * 機能:
 *   ・ターゲット 選択 (全 / 連携済 / 未連携)
 *   ・配信 種別 (テキスト / 求人 カード 最大 12 件)
 *   ・予約 送信 (datetime-local)
 *   ・送信前 確認 ダイアログ (課金通数 = sentCount)
 *   ・履歴一覧 + 統計 + エラーメッセージ
 */
type Broadcast = {
  id: string;
  messageType: string;
  targetKind: "all" | "linked" | "unlinked";
  jobIds: string[] | null;
  targetCount: number;
  status: "queued" | "sending" | "sent" | "failed";
  sentCount: number;
  failedCount: number;
  scheduledFor: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type JobOption = {
  id: string;
  companyName: string;
  position: string;
};

type Props = {
  allCount: number;
  linkedCount: number;
  unlinkedCount: number;
  jobs: JobOption[];
};

type MessageKind = "text" | "job";

export function BroadcastsClient({ allCount, linkedCount, unlinkedCount, jobs }: Props) {
  const [kind, setKind] = useState<MessageKind>("text");
  const [text, setText] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [target, setTarget] = useState<"all" | "linked" | "unlinked">("all");
  const [scheduledFor, setScheduledFor] = useState<string>(""); // datetime-local 形式
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    scheduled: boolean;
    sentCount?: number;
    failedCount?: number;
    errorMessage?: string | null;
    scheduledFor?: string;
  } | null>(null);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const targetCount =
    target === "all" ? allCount : target === "linked" ? linkedCount : unlinkedCount;

  const canSubmit = useMemo(() => {
    if (sending || targetCount === 0) return false;
    if (kind === "text") return text.trim().length > 0;
    return selectedJobIds.length > 0;
  }, [sending, targetCount, kind, text, selectedJobIds]);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/agency/line/broadcasts", { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { broadcasts: Broadcast[] };
        if (active) setHistory(json.broadcasts);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [lastResult]);

  const toggleJob = (jobId: string) => {
    setSelectedJobIds((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      if (prev.length >= 12) return prev;
      return [...prev, jobId];
    });
  };

  const onSend = async () => {
    if (!canSubmit) return;

    const scheduledIso = scheduledFor ? new Date(scheduledFor).toISOString() : null;
    const isScheduled = scheduledIso !== null && new Date(scheduledIso).getTime() > Date.now();

    const summary = isScheduled
      ? `${new Date(scheduledIso).toLocaleString("ja-JP")} に ${targetCount} 人 へ 予約 配信 します。\n課金通数 ≈ ${targetCount} 通。\n\n本当に 予約 しますか?`
      : `${targetCount} 人 に 一斉配信 します。\n課金通数 ≈ ${targetCount} 通。\n\n本当に 送信 しますか?`;

    const ok = window.confirm(summary);
    if (!ok) return;
    setSending(true);
    setError(null);
    setLastResult(null);

    const body =
      kind === "text"
        ? {
            kind: "text" as const,
            text,
            target,
            ...(scheduledIso ? { scheduledFor: scheduledIso } : {}),
          }
        : {
            kind: "job" as const,
            jobIds: selectedJobIds,
            target,
            ...(scheduledIso ? { scheduledFor: scheduledIso } : {}),
          };

    try {
      const res = await fetch("/api/agency/line/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            scheduled?: boolean;
            scheduledFor?: string;
            sentCount?: number;
            failedCount?: number;
            errorMessage?: string | null;
          }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in json && json.ok)) {
        const msg =
          "message" in json && json.message
            ? json.message
            : "error" in json
              ? json.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setLastResult({
        scheduled: Boolean(json.scheduled),
        sentCount: json.sentCount,
        failedCount: json.failedCount,
        errorMessage: json.errorMessage ?? null,
        scheduledFor: json.scheduledFor,
      });
      setText("");
      setSelectedJobIds([]);
      setScheduledFor("");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">新規 配信</h2>

        {/* 配信 種別 タブ */}
        <div className="space-y-2">
          <Label className="text-xs">配信 種別</Label>
          <div className="inline-flex rounded-md ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => setKind("text")}
              className={`rounded-l-md px-4 py-1.5 text-xs font-medium transition-colors ${
                kind === "text"
                  ? "bg-emerald-500 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              テキスト
            </button>
            <button
              type="button"
              onClick={() => setKind("job")}
              className={`rounded-r-md px-4 py-1.5 text-xs font-medium transition-colors ${
                kind === "job"
                  ? "bg-emerald-500 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              求人 カード
            </button>
          </div>
        </div>

        {/* ターゲット */}
        <div className="space-y-2">
          <Label className="text-xs">配信 対象</Label>
          <div className="grid grid-cols-3 gap-2">
            <TargetCard
              label="全 友達"
              count={allCount}
              active={target === "all"}
              onClick={() => setTarget("all")}
            />
            <TargetCard
              label="連携済"
              count={linkedCount}
              active={target === "linked"}
              onClick={() => setTarget("linked")}
            />
            <TargetCard
              label="未連携"
              count={unlinkedCount}
              active={target === "unlinked"}
              onClick={() => setTarget("unlinked")}
            />
          </div>
        </div>

        {/* 本文 / 求人 ピッカー */}
        {kind === "text" ? (
          <div className="space-y-1.5">
            <Label htmlFor="bc-text" className="text-xs">
              本文 (テキスト のみ、 最大 5,000 字)
            </Label>
            <textarea
              id="bc-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={5000}
              placeholder="例: 新着 求人 を ご案内 します。"
              className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm"
            />
            <p className="text-muted-foreground text-[10px]">{text.length} / 5,000 字</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs">求人 を 選択 (最大 12 件、 carousel)</Label>
            {jobs.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                公開中 の 求人 が ありません。 先 に 求人 を 作成 して ください。
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-white p-2">
                {jobs.map((job) => {
                  const checked = selectedJobIds.includes(job.id);
                  const disabled = !checked && selectedJobIds.length >= 12;
                  return (
                    <label
                      key={job.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 ${
                        disabled ? "cursor-not-allowed opacity-40" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleJob(job.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 text-xs">
                        <p className="font-medium">{job.position}</p>
                        <p className="text-muted-foreground text-[10px]">{job.companyName}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-muted-foreground text-[10px]">選択中:{selectedJobIds.length} / 12</p>
          </div>
        )}

        {/* 予約 送信 */}
        <div className="space-y-1.5">
          <Label htmlFor="bc-schedule" className="text-xs">
            送信 タイミング
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setScheduledFor("")}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                scheduledFor === ""
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              即時 送信
            </button>
            <input
              id="bc-schedule"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            />
            {scheduledFor && (
              <span className="text-muted-foreground text-[10px]">
                {new Date(scheduledFor).toLocaleString("ja-JP")} に 配信
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-[10px]">
            予約 は 1 分 ごと の cron で 順次 実行 されます (誤差 最大 1 分)。
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {lastResult && (
          <Alert>
            <AlertDescription>
              {lastResult.scheduled
                ? `予約 完了:${
                    lastResult.scheduledFor
                      ? new Date(lastResult.scheduledFor).toLocaleString("ja-JP")
                      : ""
                  } に 配信 されます。`
                : `配信 完了:成功 ${lastResult.sentCount ?? 0} 件、 失敗 ${
                    lastResult.failedCount ?? 0
                  } 件 (課金通数 ≈ ${lastResult.sentCount ?? 0} 通)。`}
              {lastResult.errorMessage && (
                <span className="mt-1 block text-red-700">
                  LINE エラー:{lastResult.errorMessage}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            送信先:{targetCount.toLocaleString()} 人 (課金通数 ≈ {targetCount.toLocaleString()})
          </p>
          <Button
            onClick={onSend}
            disabled={!canSubmit}
            className="bg-[#06C755] text-white hover:bg-[#05a647]"
          >
            {sending ? "送信中..." : scheduledFor ? "予約 する" : "一斉配信"}
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">配信 履歴</h2>
        {loadingHistory ? (
          <p className="text-muted-foreground text-sm">読み込み中...</p>
        ) : history.length === 0 ? (
          <p className="text-muted-foreground text-sm">配信履歴 が ありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
            <table className="min-w-full bg-white text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">作成日時</th>
                  <th className="px-3 py-2 text-left font-medium">種別</th>
                  <th className="px-3 py-2 text-left font-medium">対象</th>
                  <th className="px-3 py-2 text-left font-medium">対象 数</th>
                  <th className="px-3 py-2 text-left font-medium">送信</th>
                  <th className="px-3 py-2 text-left font-medium">失敗</th>
                  <th className="px-3 py-2 text-left font-medium">予約 / 実行</th>
                  <th className="px-3 py-2 text-left font-medium">状態</th>
                  <th className="px-3 py-2 text-left font-medium">エラー</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {new Date(b.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {b.messageType === "flex" ? "求人" : "テキスト"}
                    </td>
                    <td className="px-3 py-2 align-top">{targetKindLabel(b.targetKind)}</td>
                    <td className="px-3 py-2 text-right align-top">{b.targetCount}</td>
                    <td className="px-3 py-2 text-right align-top font-semibold text-emerald-700">
                      {b.sentCount}
                    </td>
                    <td className="px-3 py-2 text-right align-top text-red-700">
                      {b.failedCount > 0 ? b.failedCount : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-[10px] whitespace-nowrap">
                      {b.scheduledFor ? (
                        <>
                          予約:
                          <br />
                          {new Date(b.scheduledFor).toLocaleString("ja-JP")}
                        </>
                      ) : b.sentAt ? (
                        new Date(b.sentAt).toLocaleString("ja-JP")
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-2 align-top text-[10px] text-red-700">
                      {b.errorMessage ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TargetCard({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border p-3 text-center transition-colors ${
        active ? "border-emerald-500 bg-emerald-50" : "hover:border-slate-300"
      }`}
    >
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{count}</p>
    </button>
  );
}

function targetKindLabel(k: "all" | "linked" | "unlinked"): string {
  return k === "all" ? "全 友達" : k === "linked" ? "連携済" : "未連携";
}

function StatusBadge({ status }: { status: "queued" | "sending" | "sent" | "failed" }) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    queued: { label: "予約", cls: "bg-slate-100 text-slate-700" },
    sending: { label: "送信中", cls: "bg-blue-100 text-blue-800" },
    sent: { label: "完了", cls: "bg-emerald-100 text-emerald-800" },
    failed: { label: "失敗", cls: "bg-red-100 text-red-800" },
  };
  const m = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
  );
}

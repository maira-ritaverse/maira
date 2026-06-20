"use client";

import { useEffect, useState } from "react";

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
 *   ・本文 入力
 *   ・送信前 確認 ダイアログ (課金通数 = sentCount)
 *   ・履歴一覧 + 統計
 */
type Broadcast = {
  id: string;
  messageType: string;
  targetKind: "all" | "linked" | "unlinked";
  targetCount: number;
  status: "queued" | "sending" | "sent" | "failed";
  sentCount: number;
  failedCount: number;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type Props = {
  allCount: number;
  linkedCount: number;
  unlinkedCount: number;
};

export function BroadcastsClient({ allCount, linkedCount, unlinkedCount }: Props) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"all" | "linked" | "unlinked">("all");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ sentCount: number; failedCount: number } | null>(
    null,
  );
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const targetCount =
    target === "all" ? allCount : target === "linked" ? linkedCount : unlinkedCount;

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

  const onSend = async () => {
    if (!text.trim()) return;
    const ok = window.confirm(
      `${targetCount} 人 に 一斉配信 します。\n課金通数 ≈ ${targetCount} 通。\n\n本当に 送信 しますか?`,
    );
    if (!ok) return;
    setSending(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch("/api/agency/line/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; sentCount: number; failedCount: number }
        | { error: string; message?: string };
      if (!res.ok || !("ok" in body && body.ok)) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setLastResult({ sentCount: body.sentCount, failedCount: body.failedCount });
      setText("");
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

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {lastResult && (
          <Alert>
            <AlertDescription>
              配信 完了:成功 {lastResult.sentCount} 件、 失敗 {lastResult.failedCount} 件 (課金通数
              ≈ {lastResult.sentCount} 通)。
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            送信先:{targetCount.toLocaleString()} 人 (課金通数 ≈ {targetCount.toLocaleString()})
          </p>
          <Button
            onClick={onSend}
            disabled={!text.trim() || sending || targetCount === 0}
            className="bg-[#06C755] text-white hover:bg-[#05a647]"
          >
            {sending ? "送信中..." : "一斉配信"}
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
                  <th className="px-3 py-2 text-left font-medium">配信日時</th>
                  <th className="px-3 py-2 text-left font-medium">対象</th>
                  <th className="px-3 py-2 text-left font-medium">対象 数</th>
                  <th className="px-3 py-2 text-left font-medium">送信</th>
                  <th className="px-3 py-2 text-left font-medium">失敗</th>
                  <th className="px-3 py-2 text-left font-medium">状態</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {new Date(b.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 align-top">{targetKindLabel(b.targetKind)}</td>
                    <td className="px-3 py-2 text-right align-top">{b.targetCount}</td>
                    <td className="px-3 py-2 text-right align-top font-semibold text-emerald-700">
                      {b.sentCount}
                    </td>
                    <td className="px-3 py-2 text-right align-top text-red-700">
                      {b.failedCount > 0 ? b.failedCount : "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <StatusBadge status={b.status} />
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

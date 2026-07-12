"use client";

/**
 * Flow の dry-run(テスト実行)モーダル。
 *
 * 仮想友だち(タグ・追加日・活動日・CV イベント)を入力すると
 * 「即時 → 3 日後 → 分岐 true → ...」のタイムラインを返す。
 * 実 DB / LINE 送信は起きない。
 */
import { CheckCircle2, CircleStop, GitBranch, Play, XCircle } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineConversationTag } from "@/lib/line/conversation-tags";

type SimTimelineEntry = {
  step_order: number;
  step_name: string | null;
  action_type: string;
  elapsed_seconds: number;
  elapsed_label: string;
  branch_taken?: "true" | "false" | null;
  terminal?: "stop" | "step_missing" | "step_limit" | "no_next";
};

type SimResult = {
  timeline: SimTimelineEntry[];
  truncated: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  tags: LineConversationTag[];
};

const ACTION_LABELS: Record<string, string> = {
  send_message: "メッセージ送信",
  assign_tag: "タグ付与",
  remove_tag: "タグ削除",
  add_score: "スコア加算",
  set_field: "自由項目更新",
  wait: "待機",
  branch: "分岐",
  stop: "終了",
};

export function DryRunModal({ open, onOpenChange, flowId, tags }: Props) {
  const [daysSinceAdded, setDaysSinceAdded] = useState(0);
  const [daysSinceLastActivity, setDaysSinceLastActivity] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/agency/ma/flows/${flowId}/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          virtual_friend: {
            days_since_added: daysSinceAdded,
            days_since_last_activity: daysSinceLastActivity,
            tag_ids: Array.from(selectedTagIds),
            fields: [],
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "テスト実行に失敗しました");
        return;
      }
      const json = (await res.json()) as { result: SimResult };
      setResult(json.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogTitle className="flex items-center gap-2">
          <Play className="size-4" aria-hidden />
          Flow をテスト実行
        </AlertDialogTitle>
        <AlertDialogDescription>
          仮想の友だちを条件で作り、Flow
          が「いつ・どのステップまで・どう分岐するか」をシミュレーションします。実際の LINE 送信・DB
          更新は行いません。
        </AlertDialogDescription>

        <div className="my-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="dr-days-added">友だち追加からの日数</Label>
              <Input
                id="dr-days-added"
                type="number"
                min={0}
                value={daysSinceAdded}
                onChange={(e) => setDaysSinceAdded(Math.max(0, Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dr-days-activity">最終活動からの日数</Label>
              <Input
                id="dr-days-activity"
                type="number"
                min={0}
                value={daysSinceLastActivity}
                onChange={(e) => setDaysSinceLastActivity(Math.max(0, Number(e.target.value)))}
              />
            </div>
          </div>

          {tags.length > 0 && (
            <div className="space-y-1">
              <Label>この友だちが持っているタグ</Label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const on = selectedTagIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className={`rounded border px-2 py-0.5 text-xs ${
                        on
                          ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground text-xs">
                クリックで ON / OFF
                を切り替え。分岐が「タグを持っているか」で判定するときの動作確認に使えます。
              </p>
            </div>
          )}

          {error && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive rounded border p-3 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="max-h-[50vh] overflow-y-auto rounded border p-3">
              <div className="mb-2 text-sm font-medium">シミュレーション結果</div>
              {result.timeline.length === 0 ? (
                <p className="text-muted-foreground text-sm">ステップがありません。</p>
              ) : (
                <ol className="space-y-1.5 text-sm">
                  {result.timeline.map((e, idx) => (
                    <li
                      key={`${e.step_order}-${idx}`}
                      className="flex items-start gap-2 rounded border border-slate-200 bg-white p-2"
                    >
                      <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs">
                        {e.elapsed_label}
                      </span>
                      <span className="flex-1">
                        <span className="mr-1 font-medium">
                          Step {e.step_order}: {e.step_name ?? "(名前なし)"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          [{ACTION_LABELS[e.action_type] ?? e.action_type}]
                        </span>
                        {e.branch_taken && (
                          <span
                            className={`ml-2 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${
                              e.branch_taken === "true"
                                ? "bg-emerald-100 text-emerald-900"
                                : "bg-rose-100 text-rose-900"
                            }`}
                          >
                            <GitBranch className="size-3" aria-hidden />
                            {e.branch_taken === "true" ? "Yes 側" : "No 側"}
                          </span>
                        )}
                        {e.terminal === "stop" && (
                          <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-900">
                            <CircleStop className="size-3" aria-hidden />
                            終了
                          </span>
                        )}
                        {e.terminal === "step_missing" && (
                          <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                            <XCircle className="size-3" aria-hidden />
                            次ステップが存在しない
                          </span>
                        )}
                        {e.terminal === "no_next" && (
                          <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
                            <CheckCircle2 className="size-3" aria-hidden />
                            接続なし(ここで終わる)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {result.truncated && (
                <p className="text-muted-foreground mt-2 text-xs">
                  50 ステップで打ち切りました(ループ検出の可能性があります)。
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          <Button onClick={run} disabled={running}>
            {running ? "実行中..." : "テスト実行"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

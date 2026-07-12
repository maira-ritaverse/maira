"use client";

/**
 * Flow の AI 改善提案モーダル。
 *
 * 開いた瞬間に Claude に Flow をレビューさせ、提案リストを表示する。
 * 各提案には自動適用ボタンがあり、担当者がチェックして「選んだ提案を適用」を
 * 押すと、対応する変更をサーバー側で反映する。
 */
import { AlertTriangle, CheckCircle2, Info, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { AIFlowSuggestion } from "@/lib/ai/prompts/flow-improvement";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  /** 適用成功後に呼ぶ(親側でリロード等) */
  onApplied?: () => void;
};

type Review = {
  overall_assessment: string;
  strengths: string[];
  suggestions: AIFlowSuggestion[];
};

const CATEGORY_LABELS: Record<AIFlowSuggestion["category"], string> = {
  timing: "タイミング",
  content: "内容",
  structure: "構成",
  goal: "目標",
  risk: "リスク",
};

const CATEGORY_COLORS: Record<AIFlowSuggestion["category"], string> = {
  timing: "bg-sky-100 text-sky-900 border-sky-300",
  content: "bg-emerald-100 text-emerald-900 border-emerald-300",
  structure: "bg-violet-100 text-violet-900 border-violet-300",
  goal: "bg-amber-100 text-amber-900 border-amber-300",
  risk: "bg-rose-100 text-rose-900 border-rose-300",
};

const PRIORITY_LABELS: Record<AIFlowSuggestion["priority"], string> = {
  high: "重要",
  medium: "中",
  low: "参考",
};

const PRIORITY_COLORS: Record<AIFlowSuggestion["priority"], string> = {
  high: "text-rose-700 font-semibold",
  medium: "text-amber-700",
  low: "text-muted-foreground",
};

const APPLY_KIND_LABELS: Record<AIFlowSuggestion["apply"]["kind"], string> = {
  update_flow_meta: "Flow の設定を更新",
  update_step_delay: "ステップの待機時間を変更",
  update_step_body: "メッセージ本文を書き換え",
  update_step_name: "ステップ名を変更",
  remove_step: "ステップを削除",
  advisory_only: "自動適用不可(担当者判断)",
};

export function AiImproveModal({ open, onOpenChange, flowId, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (review || loading) return;
    void loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadReview() {
    setLoading(true);
    setError(null);
    setReview(null);
    setSelectedIndexes(new Set());
    setAppliedCount(0);
    try {
      const res = await fetch(`/api/agency/ma/flows/${flowId}/ai-improve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(body.message ?? body.error ?? "レビューの取得に失敗しました");
        return;
      }
      const json = (await res.json()) as { review: Review };
      setReview(json.review);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleSelected(index: number) {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function applySelected() {
    if (!review || selectedIndexes.size === 0) return;
    setApplying(true);
    setError(null);
    let succeeded = 0;
    let failed = 0;
    for (const idx of selectedIndexes) {
      const suggestion = review.suggestions[idx];
      if (!suggestion || suggestion.apply.kind === "advisory_only") continue;
      try {
        const res = await fetch(`/api/agency/ma/flows/${flowId}/ai-improve/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(suggestion.apply),
        });
        if (res.ok) succeeded++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setAppliedCount(succeeded);
    if (failed > 0) {
      setError(`${failed} 件の適用に失敗しました。手動で編集してください。`);
    }
    setApplying(false);
    setSelectedIndexes(new Set());
    if (succeeded > 0 && onApplied) onApplied();
  }

  const autoApplicableCount = review
    ? review.suggestions.filter((s) => s.apply.kind !== "advisory_only").length
    : 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          AI に Flow を改善してもらう
        </AlertDialogTitle>
        <AlertDialogDescription>
          Claude が現在の Flow
          をレビューし、転職エージェント業務の視点で改善提案を返します。適用したい提案にチェックを入れてください。
        </AlertDialogDescription>

        <div className="my-3 max-h-[70vh] space-y-3 overflow-y-auto">
          {loading && (
            <div className="text-muted-foreground rounded border border-dashed p-6 text-center text-sm">
              AI がレビューしています... (5〜15 秒)
            </div>
          )}

          {error && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive rounded border p-3 text-sm">
              {error}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void loadReview()}
              >
                やり直す
              </Button>
            </div>
          )}

          {appliedCount > 0 && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mr-1 inline size-4" aria-hidden />
              {appliedCount} 件の提案を Flow
              に反映しました。ページを再読み込みして変更を確認してください。
            </div>
          )}

          {review && (
            <>
              <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-sky-900">
                  <TrendingUp className="size-4" aria-hidden />
                  全体の評価
                </div>
                <p className="mt-2 text-xs text-sky-900">{review.overall_assessment}</p>
              </div>

              {review.strengths.length > 0 && (
                <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-emerald-900">
                    <CheckCircle2 className="size-4" aria-hidden />
                    良い点
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-900">
                    {review.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-border rounded border">
                <div className="border-border flex items-center justify-between border-b p-2 text-xs">
                  <div className="font-medium">
                    改善提案({review.suggestions.length} 件、うち自動適用可能 {autoApplicableCount}{" "}
                    件)
                  </div>
                  {autoApplicableCount > 0 && (
                    <div className="text-muted-foreground">
                      チェックで選択 →「選んだ提案を適用」
                    </div>
                  )}
                </div>
                <div className="divide-border divide-y">
                  {review.suggestions.length === 0 && (
                    <p className="text-muted-foreground p-4 text-center text-xs">
                      現状で十分な設計と判断されました。改善提案はありません。
                    </p>
                  )}
                  {review.suggestions.map((s, i) => {
                    const canApply = s.apply.kind !== "advisory_only";
                    const isSelected = selectedIndexes.has(i);
                    return (
                      <label
                        key={i}
                        htmlFor={`suggestion-${i}`}
                        className={`flex cursor-pointer items-start gap-2 p-3 text-xs ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        <input
                          id={`suggestion-${i}`}
                          type="checkbox"
                          checked={isSelected}
                          disabled={!canApply || applying}
                          onChange={() => toggleSelected(i)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[s.category]}`}
                            >
                              {CATEGORY_LABELS[s.category]}
                            </span>
                            <span className={PRIORITY_COLORS[s.priority]}>
                              {PRIORITY_LABELS[s.priority]}
                            </span>
                            {s.step_order != null && (
                              <span className="bg-muted rounded px-1.5 py-0.5 font-mono">
                                ステップ {s.step_order}
                              </span>
                            )}
                            <span className="font-semibold">{s.title}</span>
                          </div>
                          <p className="text-muted-foreground">{s.description}</p>
                          <p className="flex items-start gap-1">
                            <AlertTriangle
                              className="mt-0.5 size-3 shrink-0 text-amber-600"
                              aria-hidden
                            />
                            <span>
                              <strong>やること:</strong> {s.action}
                            </span>
                          </p>
                          <p className="text-muted-foreground flex items-start gap-1 text-[10px]">
                            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                            <span>
                              自動適用:{APPLY_KIND_LABELS[s.apply.kind]}
                              {s.apply.kind === "advisory_only" && ` — ${s.apply.reason}`}
                            </span>
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          {review && autoApplicableCount > 0 && (
            <>
              <Button
                variant="outline"
                onClick={() => void loadReview()}
                disabled={loading || applying}
              >
                レビューし直す
              </Button>
              <Button disabled={selectedIndexes.size === 0 || applying} onClick={applySelected}>
                {applying
                  ? "適用中..."
                  : `選んだ提案を適用${selectedIndexes.size > 0 ? `(${selectedIndexes.size} 件)` : ""}`}
              </Button>
            </>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

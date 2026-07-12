"use client";

/**
 * Flow の AI 改善 提案 モーダル。
 *
 * 開いた 時点 で 自動 的 に POST /api/agency/ma/flows/[flowId]/ai-improve を 呼び、
 * overall_assessment / strengths / suggestions を 表示。 リード オンリー。
 * admin は 提案 を 読みながら 手動 で Flow エディタ を 更新 する。
 */
import { AlertTriangle, CheckCircle2, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
};

type Suggestion = {
  category: "timing" | "content" | "structure" | "goal" | "risk";
  priority: "high" | "medium" | "low";
  step_order: number | null;
  title: string;
  description: string;
  action: string;
};

type Review = {
  overall_assessment: string;
  strengths: string[];
  suggestions: Suggestion[];
};

const CATEGORY_LABELS: Record<Suggestion["category"], string> = {
  timing: "タイミング",
  content: "内容",
  structure: "構造",
  goal: "目標",
  risk: "リスク",
};

const CATEGORY_COLORS: Record<Suggestion["category"], string> = {
  timing: "bg-sky-100 text-sky-900 border-sky-300",
  content: "bg-emerald-100 text-emerald-900 border-emerald-300",
  structure: "bg-violet-100 text-violet-900 border-violet-300",
  goal: "bg-amber-100 text-amber-900 border-amber-300",
  risk: "bg-rose-100 text-rose-900 border-rose-300",
};

const PRIORITY_LABELS: Record<Suggestion["priority"], string> = {
  high: "重要",
  medium: "中",
  low: "参考",
};

const PRIORITY_COLORS: Record<Suggestion["priority"], string> = {
  high: "text-rose-700 font-semibold",
  medium: "text-amber-700",
  low: "text-muted-foreground",
};

export function AiImproveModal({ open, onOpenChange, flowId }: Props) {
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await fetch(`/api/agency/ma/flows/${flowId}/ai-improve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "レビュー に 失敗 しました");
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

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          AI Flow 改善 提案
        </AlertDialogTitle>
        <AlertDialogDescription>
          Claude が 現在 の Flow を レビュー し、 転職 エージェント 業務 の 視点 で 改善 提案 を
          返します。 提案 は 参考 情報 です。
        </AlertDialogDescription>

        <div className="my-3 max-h-[70vh] space-y-3 overflow-y-auto">
          {loading && (
            <div className="text-muted-foreground rounded border border-dashed p-6 text-center text-sm">
              AI が レビュー 中... (5〜15 秒)
            </div>
          )}

          {error && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive rounded border p-3 text-sm">
              エラー: {error}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void loadReview()}
              >
                リトライ
              </Button>
            </div>
          )}

          {review && (
            <>
              <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-sky-900">
                  <TrendingUp className="size-4" aria-hidden />
                  全体 評価
                </div>
                <p className="mt-2 text-xs text-sky-900">{review.overall_assessment}</p>
              </div>

              {review.strengths.length > 0 && (
                <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-emerald-900">
                    <CheckCircle2 className="size-4" aria-hidden />
                    良い 点
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-900">
                    {review.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-border rounded border">
                <div className="border-border border-b p-2 text-xs font-medium">
                  改善 提案 ({review.suggestions.length} 件)
                </div>
                <div className="divide-border divide-y">
                  {review.suggestions.length === 0 && (
                    <p className="text-muted-foreground p-4 text-center text-xs">
                      改善 提案 は ありません。 現状 で 十分 な 設計 と 判断 されました。
                    </p>
                  )}
                  {review.suggestions.map((s, i) => (
                    <div key={i} className="space-y-1.5 p-3 text-xs">
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
                            Step {s.step_order}
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
                          <strong>アクション:</strong> {s.action}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          {review && (
            <Button variant="outline" onClick={() => void loadReview()} disabled={loading}>
              再レビュー
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

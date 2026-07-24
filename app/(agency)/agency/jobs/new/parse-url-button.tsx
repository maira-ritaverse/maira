"use client";

import { Link2, Sparkles, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 求人ページ URL → AI 構造化抽出 ボタン + 入力パネル
 *
 * parse-document-button(PDF / 画像)の URL 版。UX(折りたたみパネル →
 * 読み取り → プレビュー → 「フォームに 適用」)は 揃える。異なるのは 入力が
 * ファイルでは なく URL テキストで、送信先が /api/agency/jobs/parse-url な点のみ。
 *
 * JS 描画の SPA サイト等で 本文が 取れない 場合は、サーバーが 案内文を 返すので
 * ユーザーは PDF / 画像 取り込みに 切り替えられる。
 */

type ExtractedDefaults = {
  company_name: string;
  position: string;
  employment_type: string;
  location: string;
  salary_min: number | "";
  salary_max: number | "";
  description: string;
  required_skills: string;
  preferred_skills: string;
  work_change_scope: string;
  location_change_scope: string;
  smoking_prevention_measure: string;
  probation_period: string;
  work_hours: string;
  break_time: string;
  holidays: string;
  application_qualifications: string;
};

type ApiResponse = {
  defaults?: ExtractedDefaults;
  confidence?: "high" | "medium" | "low";
  extractionNotes?: string | null;
  sourceUrl?: string;
  error?: string;
  message?: string;
  detail?: string;
};

type Props = {
  onApply: (defaults: ExtractedDefaults) => void;
  disabled?: boolean;
};

export function ParseUrlButton({ onApply, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    defaults: ExtractedDefaults;
    confidence: "high" | "medium" | "low";
    extractionNotes: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  // 進捗 %(疑似)。parse-document-button と 同じ:AI 抽出は ストリーミング無しなので
  // 経過秒から 線形補間 で 進捗バーを 動かす(95% で 頭打ち)。
  const [progress, setProgress] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!isPending) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const sec = Math.round((Date.now() - startedAt) / 1000);
      setElapsedSec(sec);
      const pct = Math.min(95, Math.round(sec * 0.4));
      setProgress(pct);
    }, 500);
    return () => clearInterval(timer);
  }, [isPending]);

  const reset = () => {
    setUrl("");
    setError(null);
    setPreview(null);
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const onSubmitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setProgress(0);
    setElapsedSec(0);
    startTransition(async () => {
      try {
        const res = await fetch("/api/agency/jobs/parse-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        // Vercel タイムアウト / 関数クラッシュ 時は HTML を 返す ため、
        // JSON.parse で 死ぬ前に Content-Type で 分岐する。
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          const text = await res.text();
          throw new Error(
            `サーバが JSON を 返しませんでした (HTTP ${res.status})。ページが 大きすぎる か、AI 呼出が タイムアウト した 可能性が あります。\n\n[詳細] ${text.slice(0, 200)}`,
          );
        }
        const data = (await res.json()) as ApiResponse;
        if (!res.ok || !data.defaults) {
          const baseMessage = data.message ?? data.error ?? "取り込みに 失敗しました";
          const fullMessage = data.detail ? `${baseMessage}\n\n[詳細] ${data.detail}` : baseMessage;
          throw new Error(fullMessage);
        }
        setPreview({
          defaults: data.defaults,
          confidence: data.confidence ?? "medium",
          extractionNotes: data.extractionNotes ?? null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const onApplyClick = () => {
    if (!preview) return;
    onApply(preview.defaults);
    close();
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full"
      >
        <Link2 className="mr-2 h-4 w-4" />
        URL から AI 取り込み
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-900">
          <Sparkles className="h-4 w-4" />
          求人ページ URL から AI 取り込み
        </div>
        <button
          type="button"
          onClick={close}
          className="text-sky-900/60 hover:text-sky-900"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!preview && (
        <div className="space-y-3">
          <p className="text-xs text-sky-900/80">
            公開されている 求人媒体 / 企業採用ページ の URL を 貼り付けてください。 ページの 本文を
            読み取って 項目を 自動入力します。 読み取れない 項目は 空欄で 返ります。
          </p>

          <Input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isPending && url.trim()) {
                e.preventDefault();
                onSubmitUrl();
              }
            }}
            disabled={isPending}
            placeholder="https://example.com/jobs/12345"
            className="bg-white"
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                <pre className="text-xs whitespace-pre-wrap">{error}</pre>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={onSubmitUrl}
              disabled={!url.trim() || isPending}
              className="flex-1"
            >
              {isPending ? `AI 解析中... ${progress}%` : "AI で 読み取る"}
            </Button>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              キャンセル
            </Button>
          </div>

          {isPending && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
                <div
                  className="h-full bg-sky-500 transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-sky-900/70">
                経過 {elapsedSec} 秒 / ページを 取得して Claude Sonnet 4.6 で 構造化中(通常 15-90
                秒、長い ページは 最大 300 秒)
              </p>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="rounded-md bg-white p-3 text-xs">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-muted-foreground">読み取り精度:</span>
              <ConfidenceBadge level={preview.confidence} />
            </div>
            <dl className="grid grid-cols-[7em_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">求人企業名</dt>
              <dd className="font-medium">{preview.defaults.company_name || "(読み取れず)"}</dd>
              <dt className="text-muted-foreground">職種</dt>
              <dd className="font-medium">{preview.defaults.position || "(読み取れず)"}</dd>
              <dt className="text-muted-foreground">雇用形態</dt>
              <dd>{preview.defaults.employment_type || "—"}</dd>
              <dt className="text-muted-foreground">勤務地</dt>
              <dd>{preview.defaults.location || "—"}</dd>
              <dt className="text-muted-foreground">年収</dt>
              <dd>{formatSalary(preview.defaults.salary_min, preview.defaults.salary_max)}</dd>
            </dl>
            {preview.extractionNotes && (
              <p className="mt-2 border-t pt-2 text-xs text-sky-900/80">
                <strong>抽出メモ:</strong> {preview.extractionNotes}
              </p>
            )}
          </div>

          <p className="text-xs text-sky-900/70">
            適用すると、フォームの 全項目が 上書きされます。空欄の 項目は そのまま 空欄に なります。
          </p>

          <div className="flex gap-2">
            <Button type="button" onClick={onApplyClick} className="flex-1">
              フォームに 適用
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              やり直し
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const cls =
    level === "high"
      ? "bg-emerald-100 text-emerald-800"
      : level === "medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  const label = level === "high" ? "高" : level === "medium" ? "中" : "低";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>;
}

function formatSalary(min: number | "", max: number | ""): string {
  if (min !== "" && max !== "") return `${min}〜${max} 万円`;
  if (min !== "") return `${min} 万円〜`;
  if (max !== "") return `〜${max} 万円`;
  return "—";
}

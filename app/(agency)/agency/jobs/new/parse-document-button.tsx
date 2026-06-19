"use client";

import { FileText, Sparkles, Upload, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * 求人票 PDF / 画像 → AI 構造化抽出 ボタン + アップロード パネル
 *
 * 設計判断:
 *   ・モーダルダイアログ は 使わず、フォーム上部に 折りたたみ パネルとして 配置。
 *     既存 UI に Dialog component が 入っていない こと、また
 *     「フォームと 並べて 結果を 確認したい」という ユースケースに 合致するため。
 *   ・ファイル選択 → アップロード → AI 抽出 → 「適用」ボタンの 2 段階。
 *     AI 失敗 / 内容が おかしい 場合に ユーザーが 「適用しない」を 選べる。
 *   ・適用時に 親フォームの reset() を 呼び、抽出結果で フィールドを 一斉に 上書き。
 *     部分マージ(空欄のみ AI で 補完)は 今回は 入れない:「全部 上書き」の 方が
 *     エージェント側 ユーザの メンタルモデルに 合いやすい(やり直したい 場合は
 *     再度 アップロード)。
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
  error?: string;
  message?: string;
  /** AI SDK 由来の 生エラーメッセージ。表示すると 原因特定が 速い。 */
  detail?: string;
};

type Props = {
  onApply: (defaults: ExtractedDefaults) => void;
  disabled?: boolean;
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

export function ParseDocumentButton({ onApply, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    defaults: ExtractedDefaults;
    confidence: "high" | "medium" | "low";
    extractionNotes: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setError(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const onSelectFile = (f: File | null) => {
    setError(null);
    setPreview(null);
    setFile(f);
  };

  const onUpload = () => {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch("/api/agency/jobs/parse-document", {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as ApiResponse;
        if (!res.ok || !data.defaults) {
          // detail(AI SDK の 生エラー)が あれば 末尾に 添えて、原因 特定を 早める
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
        <Sparkles className="mr-2 h-4 w-4" />
        PDF / 画像から AI 取り込み
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <Sparkles className="h-4 w-4" />
          求人票から AI 取り込み
        </div>
        <button
          type="button"
          onClick={close}
          className="text-amber-900/60 hover:text-amber-900"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!preview && (
        <div className="space-y-3">
          <p className="text-xs text-amber-900/80">
            PDF / 画像(PNG / JPEG / WEBP)を 1 件 アップロードしてください。 最大 10MB。 読み取れない
            項目は 空欄で 返ります。
          </p>

          <label
            htmlFor="job-parse-file"
            className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-amber-300 bg-white px-3 py-3 text-sm hover:bg-amber-50"
          >
            <Upload className="h-4 w-4 text-amber-900/70" />
            {file ? (
              <span className="flex items-center gap-2 truncate">
                <FileText className="h-4 w-4" />
                <span className="truncate">{file.name}</span>
                <span className="text-muted-foreground text-xs">
                  ({Math.round(file.size / 1024)} KB)
                </span>
              </span>
            ) : (
              <span className="text-amber-900/70">ファイルを 選択</span>
            )}
            <input
              ref={inputRef}
              id="job-parse-file"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => onSelectFile(e.target.files?.[0] ?? null)}
            />
          </label>

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
              onClick={onUpload}
              disabled={!file || isPending}
              className="flex-1"
            >
              {isPending ? "AI 解析中..." : "AI で 読み取る"}
            </Button>
            <Button type="button" variant="outline" onClick={close} disabled={isPending}>
              キャンセル
            </Button>
          </div>
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
              <p className="mt-2 border-t pt-2 text-xs text-amber-900/80">
                <strong>抽出メモ:</strong> {preview.extractionNotes}
              </p>
            )}
          </div>

          <p className="text-xs text-amber-900/70">
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

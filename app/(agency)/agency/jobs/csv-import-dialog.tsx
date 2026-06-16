"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseCsvAsObjects } from "@/lib/csv/parse";
import { useDialog } from "@/lib/ui/use-dialog";

type ImportResultRow = {
  rowIndex: number;
  outcome: "created" | "skipped_duplicate" | "error";
  message?: string;
  jobId?: string;
};
type ImportResponse = {
  created: number;
  skippedDuplicate: number;
  errors: number;
  results: ImportResultRow[];
};

const PREVIEW_ROWS = 5;
const MAX_ROWS = 200;

/**
 * 求人 CSV インポートダイアログ。
 * 列マッピングは API 側で日本語ヘッダー固定(/api/agency/import/jobs)。
 */
export function JobsCsvImportDialog() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const reset = () => {
    setParsedHeaders([]);
    setParsedRows([]);
    setParseError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  useDialog(open, close, dialogRef);

  const handleFile = async (file: File) => {
    setParseError(null);
    setResult(null);
    try {
      const text = await file.text();
      const { headers, rows } = parseCsvAsObjects(text);
      if (headers.length === 0) {
        setParseError("CSV にヘッダー行がありません");
        return;
      }
      if (rows.length === 0) {
        setParseError("データ行がありません");
        setParsedHeaders(headers);
        return;
      }
      if (rows.length > MAX_ROWS) {
        setParseError(`行数が多すぎます(最大 ${MAX_ROWS} 行 / 検出 ${rows.length} 行)`);
        setParsedHeaders(headers);
        return;
      }
      setParsedHeaders(headers);
      setParsedRows(rows);
    } catch (err) {
      setParseError(
        `CSV のパースに失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}`,
      );
    }
  };

  const submit = async () => {
    if (parsedRows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/agency/import/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      const json = (await res.json()) as Partial<ImportResponse> & { error?: string };
      if (!res.ok) {
        setParseError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(json as ImportResponse);
      if ((json.created ?? 0) > 0) router.refresh();
    } catch (err) {
      setParseError(`通信エラー: ${err instanceof Error ? err.message : "不明なエラー"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        CSV インポート
      </Button>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="CSV インポート(求人)"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <Card className="bg-background max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">CSV インポート(求人)</h2>
              <button
                type="button"
                onClick={close}
                className="text-muted-foreground hover:text-foreground text-sm"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <section className="text-muted-foreground space-y-1 text-xs">
              <p>
                対応ヘッダー(日本語):会社名・職種・勤務地・雇用形態・年収下限/上限・仕事内容・必須/歓迎スキル・応募資格・試用期間・勤務時間・休憩時間・休日休暇・業務変更範囲・勤務地変更範囲・受動喫煙対策・ステータス
              </p>
              <p>
                必須:<span className="font-medium">会社名 / 職種</span>。
                <span className="font-medium">(会社名, 職種)</span>{" "}
                が既存と一致する求人は「重複」スキップします。
              </p>
            </section>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="block w-full text-sm"
            />

            {parseError && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {parseError}
              </div>
            )}

            {parsedRows.length > 0 && !result && (
              <section className="space-y-2">
                <div className="text-muted-foreground text-xs">
                  検出:{parsedRows.length} 行(プレビュー先頭{" "}
                  {Math.min(PREVIEW_ROWS, parsedRows.length)} 行)
                </div>
                <div className="ring-foreground/10 overflow-x-auto rounded-lg ring-1">
                  <table className="min-w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        {parsedHeaders.map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, PREVIEW_ROWS).map((row, i) => (
                        <tr key={i} className="border-t">
                          {parsedHeaders.map((h) => (
                            <td key={h} className="px-2 py-1 align-top whitespace-nowrap">
                              {row[h] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {result && (
              <section className="space-y-2">
                <div className="text-sm font-medium">取り込み結果</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    新規 {result.created} 件
                  </span>
                  <span className="bg-muted text-muted-foreground inline-block rounded-full px-2 py-0.5">
                    重複スキップ {result.skippedDuplicate} 件
                  </span>
                  {result.errors > 0 && (
                    <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">
                      エラー {result.errors} 件
                    </span>
                  )}
                </div>
                {result.results.some((r) => r.outcome !== "created") && (
                  <details className="text-muted-foreground rounded-lg border p-2 text-xs">
                    <summary className="cursor-pointer">エラー / スキップの詳細</summary>
                    <ul className="mt-2 list-disc space-y-0.5 pl-4">
                      {result.results
                        .filter((r) => r.outcome !== "created")
                        .map((r) => (
                          <li key={r.rowIndex}>
                            <span className="font-medium">{r.rowIndex}行目</span>:{" "}
                            {r.outcome === "skipped_duplicate" ? "重複" : "エラー"} — {r.message}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                閉じる
              </Button>
              {!result && (
                <Button onClick={submit} disabled={parsedRows.length === 0 || submitting}>
                  {submitting ? "取り込み中…" : `取り込む(${parsedRows.length} 行)`}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AiColumnMapperPanel } from "@/components/features/agency/ai-column-mapper-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseCsvAsObjects } from "@/lib/csv/parse";
import { useDialog } from "@/lib/ui/use-dialog";

type ImportResultRow = {
  rowIndex: number;
  outcome: "created" | "skipped_duplicate" | "error";
  message?: string;
  clientId?: string;
};

type ImportResponse = {
  created: number;
  skippedDuplicate: number;
  errors: number;
  results: ImportResultRow[];
};

const PREVIEW_ROWS = 5;
// API 側と同じ閾値。UI 側でも先に弾いて無駄な往復を減らす。
const MAX_ROWS = 500;

/**
 * CSV インポートダイアログ(ボタン + モーダル)。
 *
 * フロー:
 *   1) ボタンを押すとオーバーレイ表示
 *   2) ファイル選択 → ブラウザで CSV パース(lib/csv/parse)
 *   3) ヘッダー + 先頭 N 行プレビュー
 *   4) 「取り込む」を押すと API へ POST → 結果サマリ表示
 *
 * 設計方針:
 *   - 平文の名前 / メール / 電話など限定的な列だけを送る(暗号化フィールドは
 *     CSV では受け付けない)。
 *   - パースエラーや行数超過はクライアント側で先に表示する。
 *   - 完了後 router.refresh() で一覧を再取得する。
 */
export function CsvImportDialog() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  // AI マッピング 適用後の canonical キーに 揃った 行(これを 既存 import API に 送る)
  const [mappedRows, setMappedRows] = useState<Record<string, string>[] | null>(null);
  const [mapping, setMapping] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const reset = () => {
    setParsedHeaders([]);
    setParsedRows([]);
    setMappedRows(null);
    setMapping(false);
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
        setParsedHeaders([]);
        setParsedRows([]);
        return;
      }
      if (rows.length === 0) {
        setParseError("データ行がありません");
        setParsedHeaders(headers);
        setParsedRows([]);
        return;
      }
      if (rows.length > MAX_ROWS) {
        setParseError(`行数が多すぎます(最大 ${MAX_ROWS} 行 / 検出 ${rows.length} 行)`);
        setParsedHeaders(headers);
        setParsedRows([]);
        return;
      }
      setParsedHeaders(headers);
      setParsedRows(rows);
      // パース成功 → AI マッピング パネルを 即時 起動。
      setMapping(true);
      setMappedRows(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setParseError(`CSV のパースに失敗しました: ${message}`);
      setParsedHeaders([]);
      setParsedRows([]);
    }
  };

  const submit = async () => {
    const rowsToPost = mappedRows ?? parsedRows;
    if (rowsToPost.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/agency/import/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToPost }),
      });
      const json = (await res.json()) as Partial<ImportResponse> & { error?: string };
      if (!res.ok) {
        setParseError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(json as ImportResponse);
      // 1 件でも作成できたら一覧を更新する
      if ((json.created ?? 0) > 0) router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setParseError(`通信エラー: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        CSV インポート
      </Button>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="CSV インポート"
          onClick={(e) => {
            // 背景クリックで閉じる(モーダル内クリックは止める)
            if (e.target === e.currentTarget) close();
          }}
        >
          <Card className="bg-background max-h-[90vh] w-full max-w-3xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">CSV インポート(求職者)</h2>
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
                任意の フォーマットの CSV を 取り込めます。ヘッダー名が 不揃いでも、AI が
                標準カラム(氏名・メール・電話・都道府県 など)への 対応付けを 提案します。
              </p>
              <p>
                必須:<span className="font-medium">氏名 / メール</span>。受付日は YYYY-MM-DD または
                YYYY/MM/DD 形式。
              </p>
              <p>
                同 organization に同じメールが既にあれば「重複」としてスキップします
                (既存レコードは上書きしません)。
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

            {parsedRows.length > 0 && !result && mapping && (
              <AiColumnMapperPanel
                target="clients"
                csvHeaders={parsedHeaders}
                parsedRows={parsedRows}
                onApply={(canonicalRows) => {
                  setMappedRows(canonicalRows);
                  setMapping(false);
                }}
                onCancel={() => setMapping(false)}
              />
            )}

            {parsedRows.length > 0 && !result && !mapping && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground text-xs">
                    検出:{parsedRows.length} 行(プレビュー先頭{" "}
                    {Math.min(PREVIEW_ROWS, parsedRows.length)} 行)
                    {mappedRows && (
                      <span className="ml-2 text-emerald-700">・AI マッピング 適用済み</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setMapping(true)}
                  >
                    {mappedRows ? "マッピングを やり直す" : "AI カラム マッピング"}
                  </Button>
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
                <Button
                  onClick={submit}
                  disabled={parsedRows.length === 0 || mapping || submitting || !mappedRows}
                  title={
                    !mappedRows && parsedRows.length > 0
                      ? "AI マッピングを 適用してから 取り込みできます"
                      : undefined
                  }
                >
                  {submitting ? "取り込み中…" : `取り込む(${(mappedRows ?? parsedRows).length} 行)`}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

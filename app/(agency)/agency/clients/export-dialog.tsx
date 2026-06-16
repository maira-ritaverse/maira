"use client";

import { useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_COLUMNS,
  type ExportColumnKey,
} from "@/lib/clients/export-columns";
import { useDialog } from "@/lib/ui/use-dialog";

/**
 * CSV エクスポートダイアログ
 *
 * 列を選んで /api/agency/export/clients?columns=... をダウンロードする。
 * チェックボックスは EXPORT_COLUMNS の順番に並べる(API の出力順とも揃う)。
 *
 * 単純な ExportButton(列固定)とは差し替えになる。
 * 認証エラー / 権限エラーの扱いは fetch ベースで共通(エクスポート権限が無い
 * 場合はそもそもボタンが出ない)。
 */
export function ExportDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<ExportColumnKey>>(new Set(DEFAULT_EXPORT_COLUMNS));
  const [downloading, setDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useDialog(open, () => setOpen(false), dialogRef);

  const toggle = (key: ExportColumnKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(EXPORT_COLUMNS.map((c) => c.key)));
  const selectDefault = () => setSelected(new Set(DEFAULT_EXPORT_COLUMNS));
  const clearAll = () => setSelected(new Set());

  const download = async () => {
    if (selected.size === 0) {
      setErrorMessage("列を 1 つ以上選択してください");
      return;
    }
    setDownloading(true);
    setErrorMessage(null);

    try {
      // 順序は EXPORT_COLUMNS の定義順を維持(チェックされたものだけ抽出)
      const orderedKeys = EXPORT_COLUMNS.filter((c) => selected.has(c.key)).map((c) => c.key);
      const res = await fetch(`/api/agency/export/clients?columns=${orderedKeys.join(",")}`, {
        method: "GET",
      });
      if (!res.ok) {
        const msg =
          res.status === 403
            ? "エクスポート権限がありません(管理者に依頼してください)。"
            : `ダウンロードに失敗しました(HTTP ${res.status})`;
        setErrorMessage(msg);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = parseFilenameFromContentDisposition(disposition) ?? "clients.csv";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <DownloadIcon />
        CSV エクスポート
      </Button>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="CSV エクスポート"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <Card className="bg-background max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">CSV エクスポート(列選択)</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                {selected.size} 列選択中 / 全 {EXPORT_COLUMNS.length} 列
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="hover:text-foreground text-muted-foreground underline-offset-4 hover:underline"
              >
                すべて
              </button>
              <button
                type="button"
                onClick={selectDefault}
                className="hover:text-foreground text-muted-foreground underline-offset-4 hover:underline"
              >
                既定に戻す
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="hover:text-foreground text-muted-foreground underline-offset-4 hover:underline"
              >
                解除
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
              {EXPORT_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(col.key)}
                    onChange={() => toggle(col.key)}
                    className="cursor-pointer"
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>

            {errorMessage && <p className="text-destructive text-xs">{errorMessage}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                閉じる
              </Button>
              <Button onClick={download} disabled={downloading || selected.size === 0}>
                {downloading ? "ダウンロード中…" : `ダウンロード(${selected.size} 列)`}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function parseFilenameFromContentDisposition(value: string): string | null {
  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // フォールバックへ
    }
  }
  const plainMatch = /filename\s*=\s*"([^"]+)"/i.exec(value);
  if (plainMatch) return plainMatch[1];
  return null;
}

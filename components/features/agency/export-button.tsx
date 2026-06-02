"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type ExportButtonProps = {
  /** ダウンロード API のパス(例:/api/agency/export/clients) */
  href: string;
  /** ボタンに出すラベル(例:CSV エクスポート) */
  label: string;
};

/**
 * CSV エクスポートボタン(共通)
 *
 * クリック時に API を fetch して Blob を取得 → a タグで download トリガ。
 * 単純な anchor download だと:
 *   - 認証エラー時に画面遷移しちゃう(401 ページに行ったり)
 *   - filename がレスポンスヘッダから取りにくい
 * という問題があるため、fetch + Blob で握ってからダウンロードする。
 *
 * 表示の出し分け(admin OR export 権限)は呼び出し側ページで判定する想定。
 * (ボタン自身に role/permission を持たせず再利用しやすくする)
 */
export function ExportButton({ href, label }: ExportButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setIsDownloading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(href, { method: "GET" });

      if (!res.ok) {
        // サーバー側で 403 になっても、ボタンが表示されている状況では基本起きない。
        // 起きた場合はユーザに表示する。
        const msg =
          res.status === 403
            ? "エクスポート権限がありません(管理者に依頼してください)。"
            : `ダウンロードに失敗しました(HTTP ${res.status})`;
        setErrorMessage(msg);
        return;
      }

      // Content-Disposition の filename*=UTF-8'' を優先して取り出す
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = parseFilenameFromContentDisposition(disposition) ?? "export.csv";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "通信エラーが発生しました");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={handleClick} disabled={isDownloading}>
        <DownloadIcon />
        {isDownloading ? "ダウンロード中…" : label}
      </Button>
      {errorMessage && <p className="text-destructive text-xs">{errorMessage}</p>}
    </div>
  );
}

/**
 * Content-Disposition から filename を取り出す。
 * filename*=UTF-8''<percent-encoded> を最優先、無ければ filename="..."。
 */
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

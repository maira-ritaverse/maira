"use client";

/**
 * CSV エクスポート集約メニュー。
 *
 * 5 種類の CSV ボタンを縦積みしていたのを、1 つのドロップダウンに集約。
 * ドロップダウン内から選ぶと fetch + Blob でダウンロード。
 * ExportButton の内部ロジック(認証エラー処理・ファイル名解決)をそのまま踏襲。
 */
import { Download, FileText } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ExportItem = {
  href: string;
  label: string;
};

const EXPORTS: ExportItem[] = [
  { href: "/api/agency/export/placements", label: "成約・売上" },
  { href: "/api/agency/export/referrals", label: "応募" },
  { href: "/api/agency/export/interviews", label: "面接履歴" },
  { href: "/api/agency/export/tasks", label: "タスク" },
  { href: "/api/agency/export/line-broadcasts", label: "LINE 一斉配信" },
];

export function ExportMenu() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function download(item: ExportItem) {
    setDownloading(item.href);
    setErrorMessage(null);
    try {
      const res = await fetch(item.href);
      if (!res.ok) {
        setErrorMessage(`ダウンロードに失敗しました (${res.status})`);
        return;
      }
      // Content-Disposition から filename を取り出し(なければ label ベース)
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename\*?=(?:UTF-8'')?"?([^;"]+)"?/.exec(disposition);
      const filename = match?.[1] ? decodeURIComponent(match[1]) : `${item.label}.csv`;

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
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <Download className="mr-1 size-3" aria-hidden />
              CSV エクスポート
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-40">
          {EXPORTS.map((item) => (
            <DropdownMenuItem
              key={item.href}
              onClick={() => void download(item)}
              disabled={downloading === item.href}
            >
              <FileText className="mr-1 size-3" aria-hidden />
              {downloading === item.href ? "取得中..." : item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {errorMessage && <p className="text-destructive text-[10px]">{errorMessage}</p>}
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { extractionToMarkdown } from "@/lib/career-intake/markdown";
import type { ExtractionResult } from "@/lib/career-intake/types";

type Props = {
  filename: string;
  extraction: ExtractionResult;
};

/**
 * 抽出結果を Markdown / JSON でダウンロードするボタン群。
 * クリックで Blob を作って <a download> でダウンロード。
 */
export function ExportButtons({ filename, extraction }: Props) {
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(extraction, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${baseName(filename)}.json`);
  };

  const downloadMarkdown = () => {
    const md = extractionToMarkdown(extraction, { title: filename });
    const blob = new Blob([md], { type: "text/markdown" });
    triggerDownload(blob, `${baseName(filename)}.md`);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={downloadMarkdown}>
        Markdown を保存
      </Button>
      <Button size="sm" variant="outline" onClick={downloadJson}>
        JSON を保存
      </Button>
    </div>
  );
}

function baseName(filename: string): string {
  // 拡張子があれば除去、ファイル名として安全な文字に
  const noExt = filename.replace(/\.[^.]+$/, "");
  return (noExt || "intake").replace(/[\\/:*?"<>|]+/g, "_");
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

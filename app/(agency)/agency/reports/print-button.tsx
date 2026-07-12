"use client";

/**
 * レポート印刷 / PDF 出力ボタン。
 *
 * ブラウザの print API を使う実装(依存追加なし)。
 * ・Chrome / Edge / Safari の「PDFとして保存」で PDF になる
 * ・サイドバー(SectionNav)と Export ボタンは @media print で非表示にする
 * ・page-break-inside: avoid をカードに掛けて 1 カードが分割されないように
 */
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
      className="no-print"
    >
      <Printer className="mr-1 size-3" aria-hidden />
      印刷 / PDF 出力
    </Button>
  );
}

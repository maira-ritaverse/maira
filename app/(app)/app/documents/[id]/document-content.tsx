"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = {
  content: string;
};

/**
 * 書類本文の表示+全文コピー
 *
 * pre + whitespace-pre-wrap で AI が生成した改行をそのまま見せる。
 * navigator.clipboard が失敗した場合(HTTPSでないローカルなど)は
 * ユーザーが手動で選択してコピーできるよう、エラー表示はしない。
 */
export function DocumentContent({ content }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック:選択して手動コピーを促す
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{content.length}文字</p>
        <Button onClick={handleCopy} variant="outline" size="sm">
          {copied ? "✓ コピーしました" : "📋 全文をコピー"}
        </Button>
      </div>
      <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">{content}</pre>
    </Card>
  );
}

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Props = {
  resumeId: string;
};

/**
 * 履歴書 AI 添削セクション
 *
 * 「AI 添削をリクエスト」ボタン → /api/resumes/[id]/feedback へ POST、
 * Markdown をストリーミングで受け取って表示。
 * 結果はサーバには保存しない(都度生成)。同じ履歴書でも複数回試せる。
 */
export function ResumeAiFeedback({ resumeId }: Props) {
  const [content, setContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    setStreaming(true);
    setContent("");
    setError(null);
    try {
      const res = await fetch(`/api/resumes/${resumeId}/feedback`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("ストリームが取得できませんでした");
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          setContent((prev) => prev + decoder.decode(value, { stream: true }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setStreaming(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">AI 添削</h2>
        <Button size="sm" onClick={request} disabled={streaming}>
          {streaming ? "添削中…" : content ? "再添削をリクエスト" : "AI に添削してもらう"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        履歴書の構造化データと自由記述を AI が解析し、改善点と具体的なリライト例を返します。
        添削結果は保存されません(都度生成)。
      </p>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {content && (
        <article className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          {content}
        </article>
      )}
    </Card>
  );
}

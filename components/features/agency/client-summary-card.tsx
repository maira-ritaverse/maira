"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * エージェント側 クライアント詳細画面の AI 状況サマリーカード
 *
 * ボタン押下で /api/agency/clients/{clientId}/summary を POST し、
 * プレーンテキストのストリーミングを TextDecoder で逐次読みながら state に追記。
 * 「## 状況」「## 次のアクション」の 2 セクションを軽量パースで表示する。
 *
 * useChat を使わない理由:
 *   サマリーは単発生成(会話履歴なし)で、サーバ側も toTextStreamResponse() で
 *   プレーンテキストを返している。useChat は会話状態管理が前提のため過剰。
 *
 * 認可・データ境界の責務はサーバ側 API に集約してある。本コンポーネントは
 * 「ボタン → fetch → ストリーミング読み → 表示 → 再生成 / エラー」のみ。
 */
export function ClientSummaryCard({ clientId }: { clientId: string }) {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSummary = useCallback(async () => {
    setText("");
    setError(null);
    setDone(false);
    setIsStreaming(true);

    try {
      const res = await fetch(`/api/agency/clients/${clientId}/summary`, {
        method: "POST",
      });

      // エラー時はサーバが JSON({ error, category, retryable })を返す設計。
      // ストリーム成功時は text/plain なので分岐する。
      if (!res.ok) {
        const message = await readErrorMessage(res);
        setError(message);
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("ストリーミング応答を読み取れませんでした。");
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      // 逐次受け取った chunk を text state に追記。setState を都度叩いて
      // React の再描画で「文字が流れる」体験にする。
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.length > 0) {
          setText((prev) => prev + chunk);
        }
      }
      // 残りバイトの flush
      const tail = decoder.decode();
      if (tail.length > 0) setText((prev) => prev + tail);

      setDone(true);
    } catch (err) {
      // ネットワーク断や fetch 自体の失敗。内部詳細は出さない。
      console.error("AI summary fetch failed:", err);
      setError("通信エラーが発生しました。接続を確認して再度お試しください。");
    } finally {
      setIsStreaming(false);
    }
  }, [clientId]);

  const hasContent = text.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="text-primary size-4" />
          <span>AI 状況サマリー</span>
        </CardTitle>
        {(done || error) && (
          <Button size="sm" variant="outline" onClick={runSummary} disabled={isStreaming}>
            再生成
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasContent && !isStreaming && !error && (
          <>
            <p className="text-muted-foreground text-sm">
              対応履歴・紹介状況・タスク・希望条件をもとに、状況と次のアクションを AI が要約します。
            </p>
            <Button size="sm" onClick={runSummary}>
              <Sparkles className="size-3.5" />
              AIで状況をまとめる
            </Button>
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {(hasContent || isStreaming) && (
          <div className="space-y-2">
            <SummaryMarkdown text={text} />
            {isStreaming && (
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <span className="bg-primary inline-block size-1.5 animate-pulse rounded-full" />
                生成中…
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * エラーレスポンスから日本語メッセージを取り出す。
 *
 * サーバ側 API はストリーム開始前のエラーで { error, category, retryable } の
 * JSON を返す(error-handler.ts の categorizeAIError を通った文言)。
 * パースに失敗した場合は HTTP ステータスから汎用文言にフォールバックする。
 * 内部スキーマ名・スタック情報は表面化させない。
 */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    // ignore — fallback below
  }
  switch (res.status) {
    case 401:
      return "ログインセッションが切れている可能性があります。再ログインしてください。";
    case 403:
      return "この操作の権限がありません。";
    case 404:
      return "対象のクライアントが見つかりませんでした。";
    case 429:
      return "リクエストが多すぎます。少し時間を置いてから再度お試しください。";
    case 502:
    case 503:
      return "AIサービスで一時的な問題が発生しています。少し時間を置いてから再度お試しください。";
    default:
      return "サマリーの生成に失敗しました。再度お試しください。";
  }
}

/**
 * 軽量 Markdown 表示
 *
 * 受信テキストは「## 見出し」と「- 箇条書き」だけを扱う。react-markdown を
 * 入れずに軽量パースで済ませる(凝ったテーブル・画像・コードブロックは
 * 想定しない)。ストリーミング中も「途中まで出来てるところを順次見せる」
 * 用途なので、未完成行(改行未到達)もそのまま行として描画する。
 */
function SummaryMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h3 key={i} className="text-foreground border-b pb-1 text-sm font-semibold">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="text-foreground/90">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-foreground/90 whitespace-pre-wrap">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let currentList: string[] | null = null;
  let currentParagraph: string[] | null = null;

  const flushList = () => {
    if (currentList && currentList.length > 0) {
      blocks.push({ kind: "list", items: currentList });
    }
    currentList = null;
  };
  const flushParagraph = () => {
    if (currentParagraph && currentParagraph.length > 0) {
      blocks.push({ kind: "paragraph", text: currentParagraph.join("\n") });
    }
    currentParagraph = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 見出し:## や ### を扱う(# は今回想定しない)。
    const headingMatch = /^#{2,3}\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushList();
      flushParagraph();
      blocks.push({ kind: "heading", text: headingMatch[1].trim() });
      continue;
    }

    // 箇条書き:- 始まり。
    const listMatch = /^\s*-\s+(.+)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      if (!currentList) currentList = [];
      currentList.push(listMatch[1].trim());
      continue;
    }

    // 空行はブロック区切り。
    if (line.length === 0) {
      flushList();
      flushParagraph();
      continue;
    }

    // それ以外は段落として束ねる。
    flushList();
    if (!currentParagraph) currentParagraph = [];
    currentParagraph.push(line);
  }

  flushList();
  flushParagraph();
  return blocks;
}

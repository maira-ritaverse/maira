"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { InterviewMessage, InterviewSession } from "@/lib/interview/sessions";

type Props = {
  session: InterviewSession;
  messages: InterviewMessage[];
};

/**
 * 面接セッションの評価レポート(印刷対応)。
 *
 * window.print() で PDF として保存できる。CSS は print-friendly に調整。
 * 「PDF として保存」ボタンは内部的に window.print() を呼ぶ(各ブラウザの
 * 保存先選択は OS の印刷ダイアログに委ねる)。
 */
export function InterviewReport({ session, messages }: Props) {
  const totalUser = messages.filter((m) => m.role === "user").length;
  const totalAssistant = messages.filter((m) => m.role === "assistant").length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/app/interview" />}>
            ← 戻る
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => window.print()}>
            PDF として保存
          </Button>
        </div>
      </div>

      <Card className="space-y-4 p-6 print:border-0 print:shadow-none">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">面接シミュレーター 評価レポート</h1>
          <p className="text-muted-foreground text-xs">
            開始:{new Date(session.startedAt).toLocaleString("ja-JP")}
            {session.completedAt && (
              <> ・ 完了:{new Date(session.completedAt).toLocaleString("ja-JP")}</>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            メッセージ:質問 {totalAssistant} 件 / 回答 {totalUser} 件
          </p>
        </header>

        {(session.positionContext.companyName || session.positionContext.position) && (
          <section className="space-y-1 rounded-md border p-3 text-sm">
            <h2 className="font-medium">面接コンテキスト</h2>
            {session.positionContext.companyName && (
              <p className="text-muted-foreground text-xs">
                想定企業:{session.positionContext.companyName}
              </p>
            )}
            {session.positionContext.position && (
              <p className="text-muted-foreground text-xs">
                ポジション:{session.positionContext.position}
              </p>
            )}
          </section>
        )}

        {session.summary && (
          <section className="space-y-2 rounded-md border-2 border-amber-300 bg-amber-50/50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/30 print:border-amber-500">
            <h2 className="font-semibold">総評(面接官 AI より)</h2>
            <div className="whitespace-pre-wrap">{session.summary}</div>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-medium">全やりとり</h2>
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-sm">メッセージがありません。</p>
          ) : (
            <ol className="space-y-3">
              {messages.map((m, i) => (
                <li key={m.id} className="space-y-1">
                  <div className="text-muted-foreground text-xs">
                    {i + 1}. {m.role === "assistant" ? "面接官 AI" : "応募者(あなた)"} ・{" "}
                    {new Date(m.createdAt).toLocaleString("ja-JP")}
                  </div>
                  <div
                    className={`rounded-md p-3 text-sm whitespace-pre-wrap ${
                      m.role === "assistant"
                        ? "bg-muted text-foreground print:bg-zinc-100"
                        : "bg-primary/10 text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="text-muted-foreground border-t pt-3 text-xs print:block">
          Maira 面接シミュレーター / このレポートは練習用です
        </footer>
      </Card>
    </div>
  );
}

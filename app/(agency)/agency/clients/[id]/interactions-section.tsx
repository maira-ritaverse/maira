"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type ClientInteractionWithAuthor,
  type InteractionType,
  getInteractionTypeConfig,
  interactionTypeConfig,
} from "@/lib/interactions/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * クライアント詳細画面の「対応履歴」セクション
 *
 * 役割:
 *   - このクライアントへの対応履歴を時系列(新しい順)で表示
 *   - 「対応を記録」インラインフォーム:種別/対応日時/メモ を POST で作成
 *
 * 履歴は server 側(page.tsx)で取得して props で渡す。
 * 記録後は router.refresh() で再取得する(楽観更新はしない)。
 *
 * 設計方針(指示書):
 *   - 入力を軽くする:項目を増やしすぎず、デフォルト値(日時=今)を活用
 *   - エージェントが手早く記録できることが最重要
 */

type Props = {
  clientId: string;
  interactions: ClientInteractionWithAuthor[];
};

export function InteractionsSection({ clientId, interactions }: Props) {
  const router = useRouter();

  return (
    <Card className="space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">対応履歴</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          電話・面談・メールなど、このクライアントへの対応を記録します
        </p>
      </div>

      <InteractionCreateForm clientId={clientId} onCreated={() => router.refresh()} />

      <InteractionList interactions={interactions} />
    </Card>
  );
}

// ============================================
// 履歴一覧(時系列、新しい順)
// ============================================

function InteractionList({ interactions }: { interactions: ClientInteractionWithAuthor[] }) {
  if (interactions.length === 0) {
    return (
      <div className="border-muted-foreground/20 text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
        まだ対応履歴がありません。上のフォームから記録してください。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">対応履歴({interactions.length}件)</h3>
      <ul className="space-y-2">
        {interactions.map((it) => (
          <InteractionRow key={it.id} interaction={it} />
        ))}
      </ul>
    </div>
  );
}

function InteractionRow({ interaction }: { interaction: ClientInteractionWithAuthor }) {
  const typeConfig = getInteractionTypeConfig(interaction.interactionType);

  return (
    <li className="border-border rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="bg-muted rounded-full px-2 py-0.5 text-xs font-medium">
              {typeConfig.label}
            </span>
            <time className="text-muted-foreground text-xs" dateTime={interaction.occurredAt}>
              {formatOccurredAt(interaction.occurredAt)}
            </time>
          </div>
          {interaction.summary && (
            <p className="mt-2 text-sm whitespace-pre-wrap">{interaction.summary}</p>
          )}
          {interaction.body && (
            <p className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">
              {interaction.body}
            </p>
          )}
        </div>
        {interaction.authorName && (
          <span className="text-muted-foreground shrink-0 text-xs">
            記録: {interaction.authorName}
          </span>
        )}
      </div>
    </li>
  );
}

// ============================================
// 新規記録フォーム(インライン展開、軽い入力)
// ============================================

function InteractionCreateForm({
  clientId,
  onCreated,
}: {
  clientId: string;
  onCreated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [interactionType, setInteractionType] = useState<InteractionType>("call");
  // datetime-local 用の初期値はローカルタイムの "YYYY-MM-DDTHH:mm" 文字列
  const [occurredAtLocal, setOccurredAtLocal] = useState<string>(() =>
    formatLocalDatetime(new Date()),
  );
  const [summary, setSummary] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setInteractionType("call");
    setOccurredAtLocal(formatLocalDatetime(new Date()));
    setSummary("");
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setError("メモを入力してください");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        // datetime-local(ローカルタイム、TZ無し)を ISO 8601(UTC、TZ付き)に変換
        // zod 側で .datetime() を満たすために必要
        const occurredAtIso = new Date(occurredAtLocal).toISOString();

        const res = await fetch("/api/agency/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_record_id: clientId,
            interaction_type: interactionType,
            occurred_at: occurredAtIso,
            summary: summary.trim(),
          }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "記録に失敗しました");
        }
        reset();
        setIsOpen(false);
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  if (!isOpen) {
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // フォームを開くたびに「今」を初期値にする
            setOccurredAtLocal(formatLocalDatetime(new Date()));
            setIsOpen(true);
          }}
        >
          + 対応を記録
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-border space-y-3 rounded-md border p-4">
      {/* 種別と日時は横並びにして縦の圧迫感を減らす(スマホでは grid-cols-1) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="interaction-type">
            種別 <span className="text-red-600">*</span>
          </Label>
          <select
            id="interaction-type"
            value={interactionType}
            onChange={(e) => setInteractionType(e.target.value as InteractionType)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {interactionTypeConfig.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="interaction-occurred-at">
            対応日時 <span className="text-red-600">*</span>
          </Label>
          <input
            id="interaction-occurred-at"
            type="datetime-local"
            value={occurredAtLocal}
            onChange={(e) => setOccurredAtLocal(e.target.value)}
            disabled={isPending}
            required
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="interaction-summary">
          メモ <span className="text-red-600">*</span>
        </Label>
        <textarea
          id="interaction-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={isPending}
          rows={3}
          maxLength={200}
          required
          placeholder="例:今後の希望条件をヒアリング。給与重視。"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <p className="text-muted-foreground text-xs">{summary.length}/200</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "記録中..." : "記録する"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            reset();
            setIsOpen(false);
          }}
        >
          キャンセル
        </Button>
      </div>
    </form>
  );
}

// ============================================
// 日時フォーマット用ヘルパー
// ============================================

/**
 * Date を datetime-local input 用のローカルタイム文字列にする。
 * "2026-06-02T12:34"(秒なし、TZ なし)
 */
function formatLocalDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 履歴一覧の日時表示。
 * 今日のものは時刻だけ、それ以前は日付+時刻。
 */
function formatOccurredAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isSameDay) return `今日 ${time}`;
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`;
}

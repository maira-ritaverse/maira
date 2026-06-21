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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * クライアント詳細画面の「対応履歴」セクション
 *
 * 役割:
 *   - このクライアントへの対応履歴を時系列(新しい順)で表示
 *   - 「対応を記録」インラインフォーム:種別/対応日時/メモ を POST で作成
 *   - 各行から編集(同 org の誰でも)・削除(admin のみ)
 *
 * 履歴は server 側(page.tsx)で取得して props で渡す。
 * 変更後は router.refresh() で再取得する(楽観更新はしない)。
 *
 * 削除権限:
 *   - DB の RLS は DELETE = admin のみ
 *   - API でも明示的に role.member.role を確認
 *   - UI 側は isAdmin の時のみ削除ボタンを表示(無駄なフォーム提示を避ける)
 */

type Props = {
  clientId: string;
  interactions: ClientInteractionWithAuthor[];
  isAdmin: boolean;
};

export function InteractionsSection({ clientId, interactions, isAdmin }: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <Card className="space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">対応履歴</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          電話・面談・メールなど、このクライアントへの対応を記録します
        </p>
      </div>

      <InteractionCreateForm clientId={clientId} onCreated={refresh} />

      <InteractionList interactions={interactions} isAdmin={isAdmin} onChanged={refresh} />
    </Card>
  );
}

// ============================================
// 履歴一覧(時系列、新しい順)
// ============================================

function InteractionList({
  interactions,
  isAdmin,
  onChanged,
}: {
  interactions: ClientInteractionWithAuthor[];
  isAdmin: boolean;
  onChanged: () => void;
}) {
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
          <InteractionRow key={it.id} interaction={it} isAdmin={isAdmin} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

function InteractionRow({
  interaction,
  isAdmin,
  onChanged,
}: {
  interaction: ClientInteractionWithAuthor;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <li className="border-border rounded-md border p-3">
        <InteractionEditForm
          interaction={interaction}
          onSaved={() => {
            setIsEditing(false);
            onChanged();
          }}
          onCancel={() => setIsEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="border-border rounded-md border p-3">
      <InteractionView
        interaction={interaction}
        isAdmin={isAdmin}
        onEdit={() => setIsEditing(true)}
        onDeleted={onChanged}
      />
    </li>
  );
}

function InteractionView({
  interaction,
  isAdmin,
  onEdit,
  onDeleted,
}: {
  interaction: ClientInteractionWithAuthor;
  isAdmin: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const typeConfig = getInteractionTypeConfig(interaction.interactionType);

  const handleDelete = () => {
    if (!window.confirm("この対応履歴を削除しますか?(元に戻せません)")) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/agency/interactions/${interaction.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "削除に失敗しました");
        }
        onDeleted();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <div className="space-y-2">
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
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
            記録:
            <Avatar className="size-4">
              {interaction.authorAvatarUrl && (
                <AvatarImage src={interaction.authorAvatarUrl} alt={interaction.authorName} />
              )}
              <AvatarFallback className="text-[8px]">
                {interaction.authorName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {interaction.authorName}
          </span>
        )}
      </div>
      <div className="flex gap-3 text-xs">
        <button
          type="button"
          onClick={onEdit}
          disabled={isPending}
          className="text-muted-foreground hover:text-foreground"
        >
          編集
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="text-muted-foreground hover:text-destructive"
          >
            {isPending ? "削除中..." : "削除"}
          </button>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ============================================
// 編集フォーム(行内展開)
// ============================================

function InteractionEditForm({
  interaction,
  onSaved,
  onCancel,
}: {
  interaction: ClientInteractionWithAuthor;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [interactionType, setInteractionType] = useState<InteractionType>(
    interaction.interactionType,
  );
  const [occurredAtLocal, setOccurredAtLocal] = useState<string>(
    formatLocalDatetime(new Date(interaction.occurredAt)),
  );
  const [summary, setSummary] = useState<string>(interaction.summary ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setError("メモを入力してください");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const occurredAtIso = new Date(occurredAtLocal).toISOString();
        const res = await fetch(`/api/agency/interactions/${interaction.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interaction_type: interactionType,
            occurred_at: occurredAtIso,
            summary: summary.trim(),
          }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "更新に失敗しました");
        }
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`edit-type-${interaction.id}`}>
            種別 <span className="text-red-600">*</span>
          </Label>
          <select
            id={`edit-type-${interaction.id}`}
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
          <Label htmlFor={`edit-occurred-${interaction.id}`}>
            対応日時 <span className="text-red-600">*</span>
          </Label>
          <input
            id={`edit-occurred-${interaction.id}`}
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
        <Label htmlFor={`edit-summary-${interaction.id}`}>
          メモ <span className="text-red-600">*</span>
        </Label>
        <textarea
          id={`edit-summary-${interaction.id}`}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={isPending}
          rows={3}
          maxLength={200}
          required
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
          {isPending ? "保存中..." : "保存"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
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

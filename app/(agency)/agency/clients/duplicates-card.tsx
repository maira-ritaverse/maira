"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ClientRecordWithUpdateBadge } from "@/lib/clients/types";
import { findDuplicateClientGroups, type DuplicateMatchReason } from "@/lib/clients/duplicates";

type DuplicatesCardProps = {
  clients: ClientRecordWithUpdateBadge[];
  /** マージ機能の有効化(admin 専用)。false なら統合ボタンを出さない。 */
  canMerge: boolean;
};

const REASON_LABEL: Record<DuplicateMatchReason, string> = {
  email: "メール一致",
  phone: "電話一致",
  name_birthdate: "氏名+生年月日一致",
  name_kana: "氏名カナ一致",
};

const REASON_TONE: Record<DuplicateMatchReason, string> = {
  email: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  phone: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  name_birthdate: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  name_kana: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

/**
 * 重複候補カード(/agency/clients 上部に常設、検出 0 件なら非表示)。
 *
 * 詳細な検出ロジックは lib/clients/duplicates.ts(純関数 + テスト済み)。
 * UI 側はグループを並べて、各クライアントの id にリンクを張るだけに徹する。
 *
 * 統合機能(マージ)は次フェーズ。今は「気付かせる + 個別に確認する」までを担当する。
 */
export function DuplicatesCard({ clients, canMerge }: DuplicatesCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [mergingGroupIdx, setMergingGroupIdx] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ClientRecordWithUpdateBadge は ClientForDuplicateDetection に必要な
  // フィールド(name/email/phone/nameKana/birthDate/id)を全て持つ。
  const groups = useMemo(() => findDuplicateClientGroups(clients), [clients]);

  if (groups.length === 0) return null;

  const startMerge = (idx: number) => {
    setMergingGroupIdx(idx);
    setTargetId(groups[idx].members[0].id); // デフォルトで最初を残す方に
    setError(null);
  };

  const cancelMerge = () => {
    setMergingGroupIdx(null);
    setTargetId("");
    setError(null);
  };

  const performMerge = async (sourceId: string) => {
    if (!targetId || sourceId === targetId) {
      setError("source と target が同一です");
      return;
    }
    const sourceName =
      groups[mergingGroupIdx ?? 0].members.find((m) => m.id === sourceId)?.name ?? "?";
    const targetName =
      groups[mergingGroupIdx ?? 0].members.find((m) => m.id === targetId)?.name ?? "?";
    if (
      !confirm(
        `${sourceName} を ${targetName} に統合します。\n${sourceName} のレコードは削除され、関連する対応履歴 / タスク / 応募 等は ${targetName} に紐づきます。\nこの操作は取り消せません。実行しますか?`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/clients/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      router.refresh();
      cancelMerge();
    } catch (err) {
      const message = err instanceof Error ? err.message : "不明なエラー";
      setError(`マージ失敗: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-3 border-red-200 bg-red-50/30 p-4 dark:border-red-900 dark:bg-red-950/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="size-4 text-red-600 dark:text-red-400" />
          <h2 className="text-sm font-semibold">重複の可能性がある顧客</h2>
          <span className="text-muted-foreground text-xs">({groups.length} グループ)</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
        >
          {expanded ? "閉じる" : "詳細を見る"}
        </button>
      </div>

      {expanded && (
        <ul className="space-y-3">
          {groups.map((g, idx) => {
            const isMerging = mergingGroupIdx === idx;
            return (
              <li
                key={idx}
                className="ring-foreground/10 space-y-2 rounded-lg bg-white/50 p-3 ring-1 dark:bg-zinc-900/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {g.reasons.map((r) => (
                      <span
                        key={r}
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${REASON_TONE[r]}`}
                      >
                        {REASON_LABEL[r]}
                      </span>
                    ))}
                    <span className="text-muted-foreground text-xs">{g.members.length} 件</span>
                  </div>
                  {canMerge && !isMerging && (
                    <Button size="sm" variant="outline" onClick={() => startMerge(idx)}>
                      統合する
                    </Button>
                  )}
                </div>

                {isMerging && (
                  <div className="ring-foreground/10 space-y-2 rounded-md bg-amber-50/50 p-2 text-xs ring-1 dark:bg-amber-950/30">
                    <p>残す方(target)を選択:</p>
                    <div className="space-y-1">
                      {g.members.map((m) => (
                        <label key={m.id} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`target-${idx}`}
                            value={m.id}
                            checked={targetId === m.id}
                            onChange={() => setTargetId(m.id)}
                          />
                          <span className="font-medium">{m.name}</span>
                          <span className="text-muted-foreground">{m.email}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">削除する方(source)を 1 件選択:</span>
                      {g.members
                        .filter((m) => m.id !== targetId)
                        .map((m) => (
                          <Button
                            key={m.id}
                            size="sm"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => performMerge(m.id)}
                          >
                            {m.name} を削除して統合
                          </Button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {error && <span className="text-red-600 dark:text-red-300">{error}</span>}
                      <button
                        type="button"
                        onClick={cancelMerge}
                        className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}

                <ul className="space-y-1">
                  {g.members.map((m) => (
                    <li key={m.id} className="text-sm">
                      <Link
                        href={`/agency/clients/${m.id}`}
                        className="hover:bg-accent flex flex-wrap items-baseline gap-2 rounded px-1 py-0.5"
                      >
                        <span className="font-medium">{m.name}</span>
                        {m.nameKana && (
                          <span className="text-muted-foreground text-xs">{m.nameKana}</span>
                        )}
                        <span className="text-muted-foreground text-xs">{m.email}</span>
                        {m.phone && (
                          <span className="text-muted-foreground text-xs">{m.phone}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

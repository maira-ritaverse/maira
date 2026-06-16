"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type MyTaskItem = {
  id: string;
  title: string;
  dueAt: string | null;
  clientRecordId: string;
  clientName: string;
};

type Props = {
  tasks: MyTaskItem[];
};

/**
 * ダッシュボードの「私の未完了タスク」ウィジェット(インタラクティブ版)。
 *
 * - チェックボックスで複数選択
 * - 「+7 日延長 / +14 日延長 / +30 日延長 / 完了化」の一括アクション
 * - 詳細遷移は行クリック(チェックボックスとボタンはイベント伝播を止める)
 *
 * 失敗は inline 表示、成功は router.refresh()。
 */
export function MyTasksWidget({ tasks }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SSR 安定のため、現在時刻ベースの「期限超過」判定はクライアント側に閉じる
  // (Date.now を server で呼ぶと react-hooks/purity に引っかかるのでこちらに集約)
  const isPastDue = (iso: string | null): boolean => {
    if (!iso) return false;
    const ms = Date.parse(iso);
    return !Number.isNaN(ms) && ms < new Date().getTime();
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clear = () => setSelectedIds(new Set());

  const submit = async (
    payload: { action: "extend_due_at"; days: number } | { action: "mark_completed" },
  ) => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/agency-tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ids: Array.from(selectedIds) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      clear();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "不明なエラー");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">私の未完了タスク</h2>
        <span className="text-muted-foreground text-xs">{tasks.length} 件</span>
      </div>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">未完了のタスクはありません</p>
      ) : (
        <>
          <ul className="divide-foreground/10 divide-y">
            {tasks.map((t) => {
              const overdue = isPastDue(t.dueAt);
              const checked = selectedIds.has(t.id);
              return (
                <li key={t.id} className="py-2 text-sm">
                  <label className="hover:bg-accent flex flex-wrap items-baseline gap-2 rounded px-1 py-1">
                    <input
                      type="checkbox"
                      className="cursor-pointer"
                      checked={checked}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggle(t.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Link
                      href={`/agency/clients/${t.clientRecordId}`}
                      className="flex flex-1 flex-wrap items-baseline justify-between gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{t.title}</span>
                        <span className="text-muted-foreground text-xs">{t.clientName}</span>
                      </div>
                      <span
                        className={`text-xs whitespace-nowrap ${
                          overdue
                            ? "font-medium text-red-600 dark:text-red-300"
                            : "text-muted-foreground"
                        }`}
                      >
                        {t.dueAt
                          ? `${new Date(t.dueAt).toLocaleDateString("ja-JP")}${overdue ? "(期限超過)" : ""}`
                          : "期限なし"}
                      </span>
                    </Link>
                  </label>
                </li>
              );
            })}
          </ul>

          {selectedIds.size > 0 && (
            <div className="ring-foreground/15 space-y-2 rounded-md p-3 ring-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs">{selectedIds.size} 件選択中</span>
                <button
                  type="button"
                  onClick={clear}
                  className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
                >
                  選択解除
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submit({ action: "extend_due_at", days: 7 })}
                  disabled={submitting}
                >
                  +7日延長
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submit({ action: "extend_due_at", days: 14 })}
                  disabled={submitting}
                >
                  +14日延長
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submit({ action: "extend_due_at", days: 30 })}
                  disabled={submitting}
                >
                  +30日延長
                </Button>
                <Button
                  size="sm"
                  onClick={() => submit({ action: "mark_completed" })}
                  disabled={submitting}
                >
                  完了化
                </Button>
              </div>
              {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  taskPriorityLabels,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/types";

/**
 * 応募詳細画面の「次にやること」セクション
 *
 * - 一覧表示(未完了 → 完了 の順、期限超過は赤字)
 * - 「+ 追加」でインラインフォーム展開 → POST /api/tasks
 * - チェックボックスで done ⇄ pending を切り替え(PATCH /api/tasks/[id])
 * - 「削除」リンクで confirm() してから DELETE /api/tasks/[id]
 *
 * 操作後は楽観的にローカル state を更新しつつ、router.refresh() で
 * 親の Server Component(=ページ全体)も再取得させる。
 */

type Props = {
  applicationId: string;
  initialTasks: Task[];
};

export function TaskList({ applicationId, initialTasks }: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム用の state(zod 検証は API 側で行うので簡素に保持)
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(0);

  const resetForm = () => {
    setTitle("");
    setDueAt("");
    setPriority(0);
  };

  const handleAdd = () => {
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            application_id: applicationId,
            title: title.trim(),
            due_at: dueAt ? `${dueAt}:00Z` : null,
            priority,
          }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string; message?: string };
          throw new Error(data.message ?? data.error ?? "Failed");
        }
        resetForm();
        setShowAddForm(false);
        // ローカルでは insert 結果(id・タイムスタンプ)が手元にないため
        // router.refresh() に頼って Server Component から最新を再取得する。
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const handleToggleDone = (taskId: string, currentStatus: TaskStatus) => {
    const newStatus: TaskStatus = currentStatus === "done" ? "pending" : "done";
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string; message?: string };
          throw new Error(data.message ?? data.error ?? "Failed to update");
        }

        // 楽観的にローカル更新(完了表示のチラつきを抑える)
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const handleDelete = (taskId: string) => {
    // ネイティブ confirm() で十分(モーダル化は将来の改善余地)
    if (!confirm("このタスクを削除しますか?")) return;
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string; message?: string };
          throw new Error(data.message ?? data.error ?? "Failed to delete");
        }
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  // 完了タスクは下に追いやる(順序内のソートは初期取得時の DB 順を尊重)
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    return 0;
  });

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">次にやること</h2>
        {!showAddForm && (
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
            + 追加
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}

      {showAddForm && (
        <div className="bg-muted/30 mt-4 space-y-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">
              タイトル <span className="text-red-600">*</span>
            </Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例:書類選考の結果を確認する"
              disabled={isPending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-due">期限</Label>
              <Input
                id="task-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-priority">優先度</Label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) as TaskPriority)}
                disabled={isPending}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value={0}>{taskPriorityLabels[0]}</option>
                <option value={1}>{taskPriorityLabels[1]}</option>
                <option value={2}>{taskPriorityLabels[2]}</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={isPending} size="sm">
              {isPending ? "追加中..." : "追加"}
            </Button>
            <Button
              onClick={() => {
                setShowAddForm(false);
                setError(null);
                resetForm();
              }}
              disabled={isPending}
              variant="outline"
              size="sm"
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {sortedTasks.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          タスクはありません。「+ 追加」から登録できます
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sortedTasks.map((task) => {
            const isDone = task.status === "done";
            const isOverdue = !isDone && task.due_at && new Date(task.due_at) < new Date();

            return (
              <li
                key={task.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  isDone ? "opacity-60" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => handleToggleDone(task.id, task.status)}
                  disabled={isPending}
                  className="mt-1 h-4 w-4 cursor-pointer"
                  aria-label={isDone ? "未完了に戻す" : "完了にする"}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${isDone ? "line-through" : ""}`}>{task.title}</p>
                  <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-xs">
                    {task.due_at && (
                      <span className={isOverdue ? "font-medium text-red-600" : ""}>
                        期限:{new Date(task.due_at).toLocaleString("ja-JP")}
                        {isOverdue && "(期限超過)"}
                      </span>
                    )}
                    {task.priority > 0 && <span>優先度:{taskPriorityLabels[task.priority]}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(task.id)}
                  disabled={isPending}
                  className="text-muted-foreground text-xs hover:text-red-600"
                >
                  削除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

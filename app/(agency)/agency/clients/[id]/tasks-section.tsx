"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type AgencyTaskPriority,
  type AgencyTaskWithAssignee,
  agencyTaskPriorityConfig,
  getAgencyTaskPriorityConfig,
} from "@/lib/agency-tasks/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/**
 * クライアント詳細画面の「タスク」セクション
 *
 * 役割:
 *   - このクライアントに対するタスクを一覧表示(未完了が上、期限が近い順)
 *   - 「タスクを追加」インラインフォーム:title/期限/優先度/担当 を POST で作成
 *   - チェックボックスで完了/未完了をトグル
 *   - 各行から編集(同 org の誰でも)・削除(admin のみ)
 *   - 期限の状態(超過/間近/余裕)に応じて色分け
 *
 * 削除権限:
 *   - DB の RLS は DELETE = admin のみ
 *   - API でも明示的に role.member.role を確認
 *   - UI 側は isAdmin の時のみ削除ボタンを表示
 *
 * 期限アラート:
 *   - 判定はクライアント側(現在時刻との比較)。サーバ側で固定値を埋めると
 *     時間が経つにつれ古くなる(SSR キャッシュ・ハイドレーション後の現在時刻
 *     ずれを避けるため、useNow で実時計を保持して 5 分ごとに更新)。
 *   - 初回レンダリング時は now=null として「色なし」を返し、マウント後に
 *     正しい色が当たる。これで hydration mismatch を回避できる。
 */

// 「期限間近」とみなす残り時間(時間単位)。指示書は 48h 目安。
const SOON_THRESHOLD_HOURS = 48;

type DueStatus = "completed" | "overdue" | "soon" | "normal" | "none";

/**
 * タスクの期限状態を判定する。
 *
 * @param dueAt   タスクの期限(ISO 文字列 or null)
 * @param now     比較に使う現在時刻(useNow で取得。マウント前は null)
 * @param isDone  完了済みかどうか
 *
 * - isDone: 完了は色を主張させない("completed" = 薄く表示)
 * - now が null(マウント前): "normal" を返し、ハイドレーション後に再評価
 * - 期限なし: "none"(色なし)
 * - now > dueAt: "overdue"
 * - now <= dueAt < now + 48h: "soon"
 * - それより先: "normal"
 */
function getDueStatus(dueAt: string | null, now: Date | null, isDone: boolean): DueStatus {
  if (isDone) return "completed";
  if (!now) return "normal";
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  const t = now.getTime();
  if (due < t) return "overdue";
  const soonCutoff = t + SOON_THRESHOLD_HOURS * 60 * 60 * 1000;
  if (due < soonCutoff) return "soon";
  return "normal";
}

/**
 * 期限状態ごとのスタイル定義。
 * 派手にしすぎないよう、背景は 50/40(薄く)、ボーダーは少し濃く。
 * priority バッジ(既存)と同じトーン(red-100/amber-100 系)で揃える。
 */
const dueStatusConfig: Record<
  DueStatus,
  {
    containerClass: string;
    badgeClass: string | null;
    badgeLabel: string | null;
    dueTextClass: string;
  }
> = {
  overdue: {
    containerClass: "border-red-300 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    badgeLabel: "期限超過",
    dueTextClass: "text-red-700 dark:text-red-300 font-medium",
  },
  soon: {
    containerClass: "border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    badgeLabel: "まもなく期限",
    dueTextClass: "text-amber-700 dark:text-amber-300",
  },
  normal: {
    containerClass: "border-border",
    badgeClass: null,
    badgeLabel: null,
    dueTextClass: "",
  },
  none: {
    containerClass: "border-border",
    badgeClass: null,
    badgeLabel: null,
    dueTextClass: "",
  },
  completed: {
    containerClass: "border-border bg-muted/30 opacity-60",
    badgeClass: null,
    badgeLabel: null,
    dueTextClass: "",
  },
};

/**
 * 現在時刻を 5 分ごとに更新する hook。
 * - SSR 時は null(server snapshot)。マウント後に client snapshot で Date を返す
 * - useSyncExternalStore を使う理由:
 *   - SSR の null と マウント直後の Date の差し替えを React が正しく扱える
 *     (hydration mismatch を回避)
 *   - useEffect 内で同期 setState を呼ぶ react-hooks/set-state-in-effect 警告も避けられる
 * - 5 分(300_000ms)ごとに更新。タスク超過の境界を分単位で検知できれば十分
 * - clientNow をモジュールスコープで保持して getSnapshot の参照同一性を担保
 *   (毎回 new Date() を返すと useSyncExternalStore が無限ループ警告を出す)
 */
let clientNow: Date = new Date();

function subscribeNow(callback: () => void): () => void {
  const id = setInterval(
    () => {
      clientNow = new Date();
      callback();
    },
    5 * 60 * 1000,
  );
  return () => clearInterval(id);
}

function getClientSnapshot(): Date {
  return clientNow;
}

function getServerSnapshot(): null {
  return null;
}

function useNow(): Date | null {
  return useSyncExternalStore(subscribeNow, getClientSnapshot, getServerSnapshot);
}

type OrgMember = { memberId: string; displayName: string | null };

type Props = {
  clientId: string;
  tasks: AgencyTaskWithAssignee[];
  members: OrgMember[];
  currentMemberId: string;
  isAdmin: boolean;
};

export function TasksSection({ clientId, tasks, members, currentMemberId, isAdmin }: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();
  // 期限色分け用の現在時刻。全タスク行で共有(各行で setInterval を回さないため)
  const now = useNow();

  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");

  return (
    <Card className="space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">タスク</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          このクライアントに対する「やること」を管理します(期限・担当を含む)
        </p>
      </div>

      <TaskCreateForm
        clientId={clientId}
        members={members}
        currentMemberId={currentMemberId}
        onCreated={refresh}
      />

      <TaskList
        pendingTasks={pending}
        completedTasks={completed}
        members={members}
        isAdmin={isAdmin}
        now={now}
        onChanged={refresh}
      />
    </Card>
  );
}

// ============================================
// 一覧(未完了 → 完了済み)
// ============================================

function TaskList({
  pendingTasks,
  completedTasks,
  members,
  isAdmin,
  now,
  onChanged,
}: {
  pendingTasks: AgencyTaskWithAssignee[];
  completedTasks: AgencyTaskWithAssignee[];
  members: OrgMember[];
  isAdmin: boolean;
  now: Date | null;
  onChanged: () => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);

  if (pendingTasks.length === 0 && completedTasks.length === 0) {
    return (
      <div className="border-muted-foreground/20 text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
        タスクがありません。上のフォームから追加してください。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 未完了タスク */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">未完了({pendingTasks.length}件)</h3>
        {pendingTasks.length === 0 ? (
          <p className="text-muted-foreground text-xs">未完了のタスクはありません。</p>
        ) : (
          <ul className="space-y-2">
            {pendingTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                members={members}
                isAdmin={isAdmin}
                now={now}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 完了タスク(折りたたみ。デフォルト閉じ) */}
      {completedTasks.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            {showCompleted ? "▼" : "▶"} 完了済み({completedTasks.length}件)
          </button>
          {showCompleted && (
            <ul className="space-y-2">
              {completedTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  members={members}
                  isAdmin={isAdmin}
                  now={now}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  members,
  isAdmin,
  now,
  onChanged,
}: {
  task: AgencyTaskWithAssignee;
  members: OrgMember[];
  isAdmin: boolean;
  now: Date | null;
  onChanged: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isDone = task.status === "completed";
  // 編集モード中も「期限超過」のコンテナ色は維持したい(状況把握のため)
  const dueStatus = getDueStatus(task.dueAt, now, isDone);
  const statusStyle = dueStatusConfig[dueStatus];

  if (isEditing) {
    return (
      <li className={`rounded-md border p-3 ${statusStyle.containerClass}`}>
        <TaskEditForm
          task={task}
          members={members}
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
    <li className={`rounded-md border p-3 ${statusStyle.containerClass}`}>
      <TaskView
        task={task}
        isAdmin={isAdmin}
        dueStatus={dueStatus}
        onEdit={() => setIsEditing(true)}
        onChanged={onChanged}
      />
    </li>
  );
}

function TaskView({
  task,
  isAdmin,
  dueStatus,
  onEdit,
  onChanged,
}: {
  task: AgencyTaskWithAssignee;
  isAdmin: boolean;
  dueStatus: DueStatus;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDone = task.status === "completed";
  const priorityConfig = task.priority ? getAgencyTaskPriorityConfig(task.priority) : null;
  const statusStyle = dueStatusConfig[dueStatus];

  const handleToggle = () => {
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/agency/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: isDone ? "pending" : "completed" }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "更新に失敗しました");
        }
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  const handleDelete = () => {
    if (!window.confirm("このタスクを削除しますか?(元に戻せません)")) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await fetch(`/api/agency/tasks/${task.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "削除に失敗しました");
        }
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isDone}
          disabled={isPending}
          onChange={handleToggle}
          aria-label={isDone ? "未完了に戻す" : "完了にする"}
          className="border-input mt-1 h-4 w-4 cursor-pointer rounded border"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm font-medium ${isDone ? "line-through" : ""}`}>{task.title}</p>
            {/* 期限アラートのバッジ(overdue / soon の時のみ) */}
            {statusStyle.badgeLabel && statusStyle.badgeClass && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${statusStyle.badgeClass}`}>
                {statusStyle.badgeLabel}
              </span>
            )}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {task.dueAt && (
              <span className={statusStyle.dueTextClass}>期限: {formatDue(task.dueAt)}</span>
            )}
            {priorityConfig && (
              <span className={`rounded-full px-2 py-0.5 ${priorityConfig.className}`}>
                優先度: {priorityConfig.label}
              </span>
            )}
            {task.assigneeName && <span>担当: {task.assigneeName}</span>}
            {isDone && task.completedAt && <span>完了: {formatDue(task.completedAt)}</span>}
          </div>
          <div className="mt-2 flex gap-3 text-xs">
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
                {isPending ? "..." : "削除"}
              </button>
            )}
          </div>
          {error && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription>エラー: {error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// 編集フォーム(行内展開)
// ============================================

function TaskEditForm({
  task,
  members,
  onSaved,
  onCancel,
}: {
  task: AgencyTaskWithAssignee;
  members: OrgMember[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueAtLocal, setDueAtLocal] = useState<string>(
    task.dueAt ? formatLocalDatetime(new Date(task.dueAt)) : "",
  );
  // priority が null の時は normal にしておく(UI で「なし」を表現するより簡潔)
  const [priority, setPriority] = useState<AgencyTaskPriority>(task.priority ?? "normal");
  const [assignedMemberId, setAssignedMemberId] = useState<string>(task.assignedMemberId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const dueAtIso = dueAtLocal ? new Date(dueAtLocal).toISOString() : null;
        const res = await fetch(`/api/agency/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            priority,
            due_at: dueAtIso,
            assigned_member_id: assignedMemberId,
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
      <div className="space-y-2">
        <Label htmlFor={`edit-title-${task.id}`}>
          タイトル <span className="text-red-600">*</span>
        </Label>
        <input
          id={`edit-title-${task.id}`}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
          maxLength={200}
          required
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`edit-due-${task.id}`}>期限</Label>
          <input
            id={`edit-due-${task.id}`}
            type="datetime-local"
            value={dueAtLocal}
            onChange={(e) => setDueAtLocal(e.target.value)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`edit-priority-${task.id}`}>優先度</Label>
          <select
            id={`edit-priority-${task.id}`}
            value={priority}
            onChange={(e) => setPriority(e.target.value as AgencyTaskPriority)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {agencyTaskPriorityConfig.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`edit-assignee-${task.id}`}>担当</Label>
          <select
            id={`edit-assignee-${task.id}`}
            value={assignedMemberId}
            onChange={(e) => setAssignedMemberId(e.target.value)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {members.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.displayName ?? "(名前未設定)"}
              </option>
            ))}
          </select>
        </div>
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
// 新規タスクフォーム(インライン展開、軽い入力)
// ============================================

function TaskCreateForm({
  clientId,
  members,
  currentMemberId,
  onCreated,
}: {
  clientId: string;
  members: OrgMember[];
  currentMemberId: string;
  onCreated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAtLocal, setDueAtLocal] = useState<string>("");
  const [priority, setPriority] = useState<AgencyTaskPriority>("normal");
  const [assignedMemberId, setAssignedMemberId] = useState<string>(currentMemberId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDueAtLocal("");
    setPriority("normal");
    setAssignedMemberId(currentMemberId);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const dueAtIso = dueAtLocal ? new Date(dueAtLocal).toISOString() : null;
        const res = await fetch("/api/agency/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_record_id: clientId,
            assigned_member_id: assignedMemberId,
            title: title.trim(),
            priority,
            due_at: dueAtIso,
          }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { error?: string; message?: string };
          throw new Error(errData.message ?? errData.error ?? "追加に失敗しました");
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
        <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
          + タスクを追加
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-border space-y-3 rounded-md border p-4">
      <div className="space-y-2">
        <Label htmlFor="task-title">
          タイトル <span className="text-red-600">*</span>
        </Label>
        <input
          id="task-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
          maxLength={200}
          required
          placeholder="例:推薦書類のレビュー、3社目の面接日程調整 など"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="task-due-at">期限</Label>
          <input
            id="task-due-at"
            type="datetime-local"
            value={dueAtLocal}
            onChange={(e) => setDueAtLocal(e.target.value)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-priority">優先度</Label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as AgencyTaskPriority)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {agencyTaskPriorityConfig.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-assignee">担当</Label>
          <select
            id="task-assignee"
            value={assignedMemberId}
            onChange={(e) => setAssignedMemberId(e.target.value)}
            disabled={isPending}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            {members.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.displayName ?? "(名前未設定)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "追加中..." : "タスクを追加"}
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
// 日時フォーマット
// ============================================

function formatLocalDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * 期限・完了日時の表示。
 * 今日のものは時刻だけ、それ以外は日付+時刻。
 */
function formatDue(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isSameDay) return `今日 ${time}`;
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`;
}

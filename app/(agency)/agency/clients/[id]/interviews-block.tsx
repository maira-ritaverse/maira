"use client";

/**
 * 面接 ラウンド 一覧 + 追加 / 結果 更新 の UI。
 *
 * 顧客 詳細 の 応募 セクション 内 で referral 単位 に レンダー する。
 * 「1 次 面接 予定 → 実施 済 に 更新 → 2 次 面接 追加」 という 業務 フロー を
 * この ブロック 単独 で 完結 でき る よう に する。
 *
 * 2026-07-14 UX 改善: window.confirm を ConfirmDialog に、
 * "HTTP N" などの dev ジャーゴンエラーを toast + errorToJapanese に置換。
 * 保存 / 削除 成功時は success toast を出す。
 */
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Interview, InterviewKind, InterviewResult } from "@/lib/interviews/types";
import { KIND_LABEL, RESULT_LABEL } from "@/lib/interviews/types";
import { apiRequest, errorToJapanese } from "@/lib/errors/messages";
import { useToast } from "@/lib/admin/toast/store";

type Props = {
  referralId: string;
};

const KIND_OPTIONS: InterviewKind[] = ["first", "second", "final", "offer", "company"];
const RESULT_OPTIONS: InterviewResult[] = ["scheduled", "done", "canceled", "no_show"];

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
}

function resultTone(result: InterviewResult): string {
  switch (result) {
    case "done":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    case "canceled":
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    case "no_show":
      return "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
    case "scheduled":
    default:
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  }
}

export function InterviewsBlock({ referralId }: Props) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/agency/interviews?referral_id=${referralId}`);
      const json = (await res.json()) as { interviews: Interview[] };
      setInterviews(json.interviews ?? []);
    } catch (err) {
      showToast("error", errorToJapanese(err));
    } finally {
      setLoading(false);
    }
  }, [referralId, showToast]);

  useEffect(() => {
    // マウント 時 に 面接 一覧 を fetch。 サーバ 側 fetch (RSC) で 渡す 手 も あるが
    // referral-section 全体 が Client Component なので ここ で fetch する。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void load();
  }, [load]);

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarClock className="text-muted-foreground h-3.5 w-3.5" />
          <span className="text-muted-foreground">面接 ラウンド:</span>
          {loading && <span className="text-muted-foreground text-[10px]">読み込み中…</span>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus className="h-3 w-3" />
          {showAdd ? "閉じる" : "追加"}
        </Button>
      </div>

      {showAdd && <AddInterviewForm referralId={referralId} onCreated={load} />}

      {interviews.length === 0 && !loading && !showAdd && (
        <p className="text-muted-foreground py-1 text-[11px]">
          まだ面接が登録されていません。 「追加」から 1 次面接を登録してください。
        </p>
      )}

      <ul className="space-y-1">
        {interviews.map((iv) => (
          <li key={iv.id}>
            <InterviewRow interview={iv} onChanged={load} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddInterviewForm({
  referralId,
  onCreated,
}: {
  referralId: string;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<InterviewKind>("first");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const submit = () => {
    if (!when) {
      showToast("error", "日時を入力してください");
      return;
    }
    startTransition(async () => {
      try {
        await apiRequest("/api/agency/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referral_id: referralId,
            kind,
            scheduled_at: new Date(when).toISOString(),
            notes: notes.trim() || null,
          }),
        });
        setKind("first");
        setWhen("");
        setNotes("");
        showToast("success", `${KIND_LABEL[kind]} を追加しました`);
        onCreated();
      } catch (e) {
        showToast("error", errorToJapanese(e));
      }
    });
  };

  return (
    <div className="mb-1.5 space-y-1.5 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="grid grid-cols-3 gap-1.5">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as InterviewKind)}
          className="border-input bg-background rounded-md border px-1.5 py-1 text-xs"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="border-input bg-background col-span-2 rounded-md border px-1.5 py-1 text-xs"
        />
      </div>
      <input
        type="text"
        placeholder="メモ (任意)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={200}
        className="border-input bg-background w-full rounded-md border px-1.5 py-1 text-xs"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={isPending || !when}
          onClick={submit}
        >
          {isPending ? "追加中..." : "追加"}
        </Button>
      </div>
    </div>
  );
}

function InterviewRow({ interview, onChanged }: { interview: Interview; onChanged: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { showToast } = useToast();

  const updateResult = (next: InterviewResult) => {
    startTransition(async () => {
      try {
        await apiRequest(`/api/agency/interviews/${interview.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: next }),
        });
        showToast("success", `結果を「${RESULT_LABEL[next]}」に更新しました`);
        onChanged();
      } catch (e) {
        showToast("error", errorToJapanese(e));
      }
    });
  };

  const doRemove = () => {
    startTransition(async () => {
      try {
        await apiRequest(`/api/agency/interviews/${interview.id}`, { method: "DELETE" });
        showToast("success", `${KIND_LABEL[interview.kind]} を削除しました`);
        setConfirmOpen(false);
        onChanged();
      } catch (e) {
        showToast("error", errorToJapanese(e));
      }
    });
  };

  const [t, setT] = useState<string>(toDatetimeLocal(interview.scheduledAt));
  const [editingTime, setEditingTime] = useState(false);
  const saveTime = () => {
    startTransition(async () => {
      try {
        await apiRequest(`/api/agency/interviews/${interview.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduled_at: new Date(t).toISOString() }),
        });
        setEditingTime(false);
        showToast("success", "面接時刻を更新しました");
        onChanged();
      } catch (e) {
        showToast("error", errorToJapanese(e));
      }
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs dark:bg-slate-950/40">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-slate-700">
          {KIND_LABEL[interview.kind]}
        </span>
        {editingTime ? (
          <>
            <input
              type="datetime-local"
              value={t}
              onChange={(e) => setT(e.target.value)}
              className="border-input bg-background rounded-md border px-1 py-0.5 text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-[10px]"
              disabled={isPending}
              onClick={saveTime}
            >
              保存
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-[10px]"
              onClick={() => setEditingTime(false)}
            >
              キャンセル
            </Button>
          </>
        ) : (
          <button
            type="button"
            className="hover:underline"
            onClick={() => setEditingTime(true)}
            title="時刻を変更"
          >
            {formatJst(interview.scheduledAt)}
          </button>
        )}
        <select
          value={interview.result}
          onChange={(e) => updateResult(e.target.value as InterviewResult)}
          disabled={isPending}
          className={`rounded px-1 py-0.5 text-[10px] font-medium ${resultTone(interview.result)}`}
        >
          {RESULT_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {RESULT_LABEL[r]}
            </option>
          ))}
        </select>
        {interview.notes && (
          <span className="text-muted-foreground truncate text-[10px]">({interview.notes})</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-1 text-red-600 hover:text-red-700"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
          aria-label="削除"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${KIND_LABEL[interview.kind]} を削除しますか?`}
        description="この操作は取り消せません。 削除しても referral 自体は残ります。"
        confirmLabel="削除"
        destructive
        pending={isPending}
        onConfirm={doRemove}
      />
    </>
  );
}

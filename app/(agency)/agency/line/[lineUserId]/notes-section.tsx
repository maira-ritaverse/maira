"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * ノート セクション (右 サイドバー 内)
 *
 * 機能:
 *   ・新規 作成 / 編集 / 削除
 *   ・件数 表示
 *   ・内部メモ (相手 には 見えない)
 */
type Note = {
  id: string;
  content: string;
  createdByLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = { lineUserId: string };

export function NotesSection({ lineUserId }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/agency/line/notes/${encodeURIComponent(lineUserId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { notes: Note[] };
      setNotes(json.notes);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/agency/line/notes/${encodeURIComponent(lineUserId)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { notes: Note[] };
        if (active) setNotes(json.notes);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchOnce();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [lineUserId]);

  const startCompose = () => {
    setEditingId(null);
    setDraftContent("");
    setComposeOpen(true);
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setDraftContent(note.content);
    setComposeOpen(true);
  };

  const onSave = async () => {
    if (!draftContent.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = editingId
        ? `/api/agency/line/notes/${encodeURIComponent(lineUserId)}/${editingId}`
        : `/api/agency/line/notes/${encodeURIComponent(lineUserId)}`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draftContent }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setComposeOpen(false);
      setEditingId(null);
      setDraftContent("");
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("この ノート を 削除 しますか?")) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/line/notes/${encodeURIComponent(lineUserId)}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 border-b px-4 py-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold">ノート {!loading && `(${notes.length})`}</p>
        <button
          type="button"
          onClick={startCompose}
          className="text-[11px] font-medium text-emerald-700 hover:underline"
        >
          + ノートを追加
        </button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-[11px]">{error}</AlertDescription>
        </Alert>
      )}

      {composeOpen && (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-2">
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={4}
            maxLength={10000}
            placeholder="内部メモ (相手 には 見えません)"
            className="w-full resize-y rounded-md border border-slate-200 bg-white p-2 text-xs"
          />
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setComposeOpen(false);
                setEditingId(null);
              }}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button size="sm" onClick={onSave} disabled={submitting || !draftContent.trim()}>
              {submitting ? "保存中..." : editingId ? "更新" : "保存"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground text-[11px]">読み込み中...</p>
      ) : notes.length === 0 && !composeOpen ? (
        <div className="rounded-md bg-slate-50 p-3 text-[11px] text-slate-600">
          <p className="font-semibold">相手 と の やりとり を 記録 できます</p>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            引き継ぎ用 メモ や 注意事項 を 残せます。 (相手 には 見えません)
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-slate-200 bg-white p-2">
              <p className="text-[12px] whitespace-pre-wrap text-slate-800">{n.content}</p>
              <div className="mt-1.5 flex items-center justify-between gap-1">
                <p className="text-[9px] text-slate-500">
                  {new Date(n.createdAt).toLocaleString("ja-JP", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {n.createdByLabel && ` · ${n.createdByLabel}`}
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(n)}
                    className="text-slate-500 hover:text-emerald-700"
                    aria-label="編集"
                  >
                    <Pencil className="size-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(n.id)}
                    className="text-slate-500 hover:text-red-700"
                    aria-label="削除"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

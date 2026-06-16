"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { Announcement } from "@/lib/announcements/types";

type ItemWithRead = Announcement & { isRead: boolean };

type Props = {
  initialAnnouncements: ItemWithRead[];
  isAdmin: boolean;
};

export function AnnouncementsClient({ initialAnnouncements, isAdmin }: Props) {
  const [items, setItems] = useState<ItemWithRead[]>(initialAnnouncements);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      setError("タイトルと本文を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const json = await apiFetch<{ announcement?: Announcement }>("/api/agency/announcements", {
        method: "POST",
        json: { title, body, isPinned },
      });
      if (json?.announcement) {
        setItems((prev) => [{ ...json.announcement!, isRead: false }, ...prev]);
      }
      setShowCreate(false);
      setTitle("");
      setBody("");
      setIsPinned(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const togglePinned = async (a: ItemWithRead) => {
    setError(null);
    try {
      await apiFetch(`/api/agency/announcements/${a.id}`, {
        method: "PATCH",
        json: { isPinned: !a.isPinned },
      });
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, isPinned: !a.isPinned } : x)));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const remove = async (a: ItemWithRead) => {
    if (!confirm(`「${a.title}」を削除しますか?`)) return;
    setError(null);
    try {
      await apiFetch(`/api/agency/announcements/${a.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== a.id));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const markRead = async (a: ItemWithRead) => {
    if (a.isRead) return;
    try {
      await apiFetch(`/api/agency/announcements/${a.id}`, {
        method: "PATCH",
        json: { markRead: true },
      });
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, isRead: true } : x)));
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{items.length} 件</span>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowCreate(true)} disabled={showCreate}>
            + 新規お知らせ
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {showCreate && (
        <Card className="space-y-2 p-3">
          <h3 className="text-sm font-medium">新規お知らせ</h3>
          <Input
            placeholder="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <textarea
            placeholder="本文"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={5000}
            className="border-input bg-background w-full rounded-lg border px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
            />
            ピン留め(常に上に表示)
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={submitting}>
              {submitting ? "投稿中…" : "投稿"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                setTitle("");
                setBody("");
                setIsPinned(false);
              }}
            >
              キャンセル
            </Button>
          </div>
        </Card>
      )}

      <ul className="space-y-2">
        {items.length === 0 && (
          <li className="text-muted-foreground py-6 text-center text-sm">
            まだお知らせがありません
          </li>
        )}
        {items.map((a) => (
          <li key={a.id}>
            <Card
              className={`space-y-2 p-3 ${
                !a.isRead ? "border-primary/40 ring-primary/10 ring-1" : ""
              }`}
              onClick={() => markRead(a)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {a.isPinned && (
                    <span className="text-amber-500" title="ピン留め">
                      📌
                    </span>
                  )}
                  <h3 className="text-sm font-medium">{a.title}</h3>
                  {!a.isRead && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      未読
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        void togglePinned(a);
                      }}
                    >
                      {a.isPinned ? "ピン外す" : "ピン留め"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(a);
                      }}
                    >
                      削除
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-muted-foreground text-xs whitespace-pre-wrap">{a.body}</p>
              <p className="text-muted-foreground text-[10px]">
                {new Date(a.createdAt).toLocaleString("ja-JP")}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

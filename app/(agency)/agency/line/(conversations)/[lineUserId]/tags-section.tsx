"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * タグ セクション (右 サイドバー)
 *
 * 機能:
 *   ・現在 付いて いる タグ を 表示
 *   ・「+ タグ を追加」 で 選択 / 作成
 *   ・タグ を X で 解除
 *
 * 完全置換 で 同期 する シンプル UX。
 */
type Tag = { id: string; name: string; color: string | null };

type Props = { lineUserId: string };

export function TagsSection({ lineUserId }: Props) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [saving, setSaving] = useState(false);

  const reloadAll = async () => {
    const [tagsRes, assignedRes] = await Promise.all([
      fetch("/api/agency/line/tags"),
      fetch(`/api/agency/line/tag-assignments/${encodeURIComponent(lineUserId)}`),
    ]);
    if (tagsRes.ok) {
      const j = (await tagsRes.json()) as { tags: Tag[] };
      setAllTags(j.tags);
    }
    if (assignedRes.ok) {
      const j = (await assignedRes.json()) as { tagIds: string[] };
      setAssignedIds(new Set(j.tagIds));
    }
  };

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const [tagsRes, assignedRes] = await Promise.all([
          fetch("/api/agency/line/tags", { signal: ctrl.signal }),
          fetch(`/api/agency/line/tag-assignments/${encodeURIComponent(lineUserId)}`, {
            signal: ctrl.signal,
          }),
        ]);
        if (tagsRes.ok) {
          const j = (await tagsRes.json()) as { tags: Tag[] };
          if (active) setAllTags(j.tags);
        }
        if (assignedRes.ok) {
          const j = (await assignedRes.json()) as { tagIds: string[] };
          if (active) setAssignedIds(new Set(j.tagIds));
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (active) setError(getErrorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [lineUserId]);

  const sync = async (nextIds: Set<string>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agency/line/tag-assignments/${encodeURIComponent(lineUserId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tagIds: Array.from(nextIds) }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setAssignedIds(nextIds);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onToggle = (tagId: string) => {
    const next = new Set(assignedIds);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    void sync(next);
  };

  const onCreateTag = async () => {
    if (!newTagName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/line/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { tag: Tag };
      setNewTagName("");
      await reloadAll();
      // 作成 直後 に この 友達 に も 紐付け
      const next = new Set(assignedIds);
      next.add(json.tag.id);
      await sync(next);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const assignedTags = allTags.filter((t) => assignedIds.has(t.id));
  const unassignedTags = allTags.filter((t) => !assignedIds.has(t.id));

  return (
    <div className="space-y-2 border-b px-4 py-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold">タグ</p>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="text-[11px] font-medium text-emerald-700 hover:underline"
        >
          + タグを追加
        </button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-[11px]">{error}</AlertDescription>
        </Alert>
      )}

      {/* 付いて いる タグ */}
      {!loading && assignedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {assignedTags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: t.color ?? "#E5E7EB",
                color: t.color ? "#fff" : "#374151",
              }}
            >
              {t.name}
              <button
                type="button"
                onClick={() => onToggle(t.id)}
                disabled={saving}
                aria-label="解除"
                className="hover:opacity-70"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ピッカー */}
      {pickerOpen && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          {unassignedTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {unassignedTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onToggle(t.id)}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] hover:border-emerald-500"
                >
                  <Plus className="size-2.5" aria-hidden />
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="新しい タグ"
              maxLength={40}
              className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
            />
            <Button size="sm" onClick={onCreateTag} disabled={!newTagName.trim() || saving}>
              作成
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground text-[11px]">読み込み中...</p>
      ) : assignedTags.length === 0 && !pickerOpen ? (
        <p className="text-muted-foreground text-[11px]">タグ が 付いて いません。</p>
      ) : null}
    </div>
  );
}

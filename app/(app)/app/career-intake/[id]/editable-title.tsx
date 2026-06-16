"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  recordingId: string;
  initialTitle: string;
};

/**
 * 録音タイトル(original_filename)の編集インライン UI。
 * クリックで input に切り替わり、保存 / キャンセル。
 */
export function EditableTitle({ recordingId, initialTitle }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (value.trim() === initialTitle) {
      setEditing(false);
      return;
    }
    if (!value.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/career-intake/recordings/${recordingId}`, {
        method: "PATCH",
        json: { originalFilename: value.trim() },
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{initialTitle}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          aria-label="タイトル編集"
        >
          編集
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          className="text-xl font-bold"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setValue(initialTitle);
              setEditing(false);
              setError(null);
            }
          }}
        />
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue(initialTitle);
            setEditing(false);
            setError(null);
          }}
        >
          キャンセル
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * LINE 友達 の 表示名 を エージェント が 上書き 編集 する inline UI。
 *
 * 表示: custom_name ?? display_name ?? "(名前なし)"
 *
 * 編集 ボタン → 入力 / 保存 / キャンセル。 空 で 保存 すると null に 戻して
 * LINE プロフィール名 (display_name) に 戻る。
 *
 * 保存 は PATCH /api/agency/line/user-links/[lineUserId] に POST。
 */
type Props = {
  lineUserId: string;
  /** LINE プロフィール名 (auto refresh で 更新 さ れる) */
  displayName: string | null;
  /** エージェント が 上書き した 名前。 null なら display_name を 使う */
  customName: string | null;
};

export function DisplayNameEditor({ lineUserId, displayName, customName }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(customName ?? displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveName = customName ?? displayName ?? "(名前なし)";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/line/user-links/${encodeURIComponent(lineUserId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customName: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-center gap-1">
        <p className="text-sm font-semibold">{effectiveName}</p>
        <button
          type="button"
          onClick={() => {
            setValue(customName ?? displayName ?? "");
            setEditing(true);
          }}
          className="text-muted-foreground hover:text-foreground rounded p-0.5"
          aria-label="表示名 を 編集"
          title="表示名 を 編集"
        >
          <Pencil className="size-3" aria-hidden />
        </button>
        {customName && (
          <span
            className="text-muted-foreground text-[10px]"
            title={`LINE プロフィール名: ${displayName ?? "なし"}`}
          >
            (編集 済)
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          disabled={saving}
          placeholder={displayName ?? ""}
          className="flex-1 rounded-md border px-2 py-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={saving}
          onClick={() => void save()}
          aria-label="保存"
          className="size-7"
        >
          <Check className="size-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={saving}
          onClick={() => setEditing(false)}
          aria-label="キャンセル"
          className="size-7"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
      <p className="text-muted-foreground text-[10px]">
        空 で 保存 する と LINE プロフィール名 に 戻ります
      </p>
    </div>
  );
}

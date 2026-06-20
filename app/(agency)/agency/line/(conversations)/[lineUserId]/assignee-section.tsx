"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 担当者 セレクター (右 サイドバー)
 *
 * 機能:
 *   ・現在 の 担当者 表示
 *   ・組織 メンバー から 選択 して 変更
 *   ・「未割当」も 選択可
 */
type Member = { userId: string; displayName: string };

type Props = {
  lineUserId: string;
  initialAssigneeUserId: string | null;
  members: Member[];
};

export function AssigneeSection({ lineUserId, initialAssigneeUserId, members }: Props) {
  const [current, setCurrent] = useState<string | null>(initialAssigneeUserId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (value: string) => {
    const newId = value === "" ? null : value;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agency/line/assignee/${encodeURIComponent(lineUserId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: newId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setCurrent(newId);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-b px-4 py-4">
      <p className="text-xs font-semibold">担当者</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-[11px]">{error}</AlertDescription>
        </Alert>
      )}
      <select
        value={current ?? ""}
        onChange={(e) => void onChange(e.target.value)}
        disabled={saving}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
      >
        <option value="">未割当</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

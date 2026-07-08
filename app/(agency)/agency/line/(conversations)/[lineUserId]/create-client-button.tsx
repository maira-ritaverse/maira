"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";

import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 会話 サイドバー 用 の 「CRM に 追加」 ボタン (Client)。
 *
 * 未 紐付け の LINE 友達 を CRM 顧客 として 新規 作成 + 自動 紐付け する 導線。
 * 成功 後 は router.refresh() で サイドバー / 一覧 を 再取得。
 */
type Props = {
  lineUserId: string;
  displayName: string | null;
};

export function CreateClientButton({ lineUserId, displayName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onClick = async () => {
    const name = displayName ?? "(名前なし)";
    if (!window.confirm(`「${name}」を CRM の 新規 顧客 として 追加 します。 よろしい ですか?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agency/line/user-links/${encodeURIComponent(lineUserId)}/create-client`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 disabled:opacity-50"
        title="LINE 友達 を CRM 顧客 として 追加"
      >
        <UserPlus className="h-3 w-3" aria-hidden />
        {busy ? "追加中…" : "CRM に 追加"}
      </button>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}

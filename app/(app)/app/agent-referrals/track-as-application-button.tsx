"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  referralId: string;
};

/**
 * 「エージェントが進めている案件」を「自分の応募管理」に追加するボタン。
 *
 * - POST /api/me/agent-referrals/[id]/track-as-application
 * - 成功時はトーストの代わりにシンプルな確認文言を表示 + ボタンをdisable
 * - エラー時は赤字でインライン
 *
 * 重複作成は API 側で許容(求職者が混乱しないように「追加済み」表示は session ローカル)。
 */
export function TrackAsApplicationButton({ referralId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (added) return;
    if (!confirm("この求人をあなたの「応募管理」に追加しますか?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/me/agent-referrals/${referralId}/track-as-application`, {
        method: "POST",
      });
      setAdded(true);
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={added ? "ghost" : "outline"}
        onClick={() => void handleClick()}
        disabled={busy || added}
      >
        {added ? "✓ 応募管理に追加済み" : busy ? "追加中…" : "応募管理に追加"}
      </Button>
      {error && <p className="text-destructive text-[10px]">{error}</p>}
    </div>
  );
}

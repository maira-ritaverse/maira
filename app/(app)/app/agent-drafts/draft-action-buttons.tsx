"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  draftId: string;
};

/**
 * 求職者ドラフトの「受領」「辞退」ボタン。
 * 各操作とも 1 タップで実行(誤操作防止に confirm 付き)。
 */
export function DraftActionButtons({ draftId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (action: "accept" | "reject") => {
    const label = action === "accept" ? "受領" : "辞退";
    if (!confirm(`このドラフトを${label}しますか?`)) return;
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/api/me/document-drafts/${draftId}`, {
        method: "PATCH",
        json: { action },
      });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void submit("reject")}
        disabled={busy !== null}
      >
        {busy === "reject" ? "辞退中…" : "辞退する"}
      </Button>
      <Button size="sm" onClick={() => void submit("accept")} disabled={busy !== null}>
        {busy === "accept" ? "受領中…" : "✓ 受領する"}
      </Button>
      {error && <p className="text-destructive text-[11px]">{error}</p>}
    </div>
  );
}

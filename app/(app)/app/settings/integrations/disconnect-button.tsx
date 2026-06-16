"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  provider: "zoom" | "google";
};

/**
 * 連携サービスの切断ボタン。
 * 確認ダイアログ → DELETE 相当の POST → ルート refresh。
 */
export function DisconnectButton({ provider }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = provider === "zoom" ? "Zoom" : "Google";

  const disconnect = async () => {
    if (!confirm(`${label} 連携を解除しますか?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/integrations/${provider}/disconnect`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" onClick={() => void disconnect()} disabled={busy}>
        {busy ? "切断中…" : `${label} 連携を解除`}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

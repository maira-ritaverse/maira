"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = { id: string };

export function AnnouncementRowActions({ id }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm("このお知らせを削除しますか?この操作は取り消せません。")) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => void handleDelete()} disabled={busy}>
        {busy ? "削除中…" : "削除"}
      </Button>
      {error && <p className="text-destructive text-[10px]">{error}</p>}
    </div>
  );
}

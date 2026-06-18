"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = { clientRecordId: string };

export function AgencyCvNewButton({ clientRecordId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: { id: string } }>("/api/agency/client-cvs", {
          method: "POST",
          json: {
            client_record_id: clientRecordId,
            title: `職務経歴書(${new Date().toLocaleDateString("ja-JP")})`,
          },
        });
        if (!res?.item) throw new Error("response_missing_item");
        router.push(`/agency/clients/${clientRecordId}/agency-cvs/${res.item.id}`);
        router.refresh();
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button size="sm" onClick={handleClick} disabled={pending}>
        {pending ? "作成中…" : "+ 新規作成"}
      </Button>
    </div>
  );
}

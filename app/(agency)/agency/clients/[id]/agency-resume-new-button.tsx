"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  clientRecordId: string;
};

/**
 * 「+ 新規作成」ボタン。即座にサーバ側で空の履歴書を作って編集画面に遷移する。
 * フォームを 1 ステップ挟む方式は手数が増えるため、タイトルだけ初期値で作って
 * 編集画面ですぐ入力できるようにする。
 */
export function AgencyResumeNewButton({ clientRecordId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await apiFetch<{ item: { id: string } }>("/api/agency/client-resumes", {
          method: "POST",
          json: {
            client_record_id: clientRecordId,
            title: `履歴書(${new Date().toLocaleDateString("ja-JP")})`,
          },
        });
        if (!res?.item) throw new Error("response_missing_item");
        router.push(`/agency/clients/${clientRecordId}/agency-resumes/${res.item.id}`);
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

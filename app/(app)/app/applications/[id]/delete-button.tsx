"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * 応募削除ボタン(確認ダイアログ付き、誤操作防止)
 *
 * 1 段階目: 「削除」を押すと確認 UI を展開
 * 2 段階目: 確認 UI で改めて「削除する」を押すと API 呼び出し
 *
 * 関連 tasks も CASCADE で消えることをユーザーに明示する。
 */

type Props = {
  applicationId: string;
};

export function DeleteButton({ applicationId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/applications/${applicationId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string; message?: string };
          throw new Error(data.message ?? data.error ?? "Delete failed");
        }
        router.push("/app/applications");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  if (!showConfirm) {
    return (
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowConfirm(true)}
          className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
        >
          この応募を削除
        </Button>
      </div>
    );
  }

  return (
    <Card className="border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/30">
      <p className="text-sm font-medium">
        本当に削除しますか?この応募に紐づくタスクもすべて削除されます。
      </p>
      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
          {isPending ? "削除中..." : "削除する"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setShowConfirm(false);
            setError(null);
          }}
          disabled={isPending}
        >
          キャンセル
        </Button>
      </div>
    </Card>
  );
}

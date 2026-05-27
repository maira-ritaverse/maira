"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * 「Mairaに相談」ボタン
 *
 * クリック → POST /api/applications/[id]/advisor/session で新規 conversation を作成
 * → そのまま advisor チャット画面に遷移。
 *
 * career_profile が未生成のユーザーは AI 文脈が作れないため、ここでブロックする
 * (実態のチェックは API 側でも行うが、ボタン段階で明示してナビゲーションを節約)。
 */

type Props = {
  applicationId: string;
  hasProfile: boolean;
};

export function AdvisorButton({ applicationId, hasProfile }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    if (!hasProfile) {
      setError("先にキャリア棚卸しを完了させてください");
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch(`/api/applications/${applicationId}/advisor/session`, {
          method: "POST",
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string; message?: string };
          throw new Error(data.message ?? data.error ?? "Failed");
        }
        const data = (await response.json()) as { conversationId: string };
        router.push(`/app/applications/${applicationId}/advisor/${data.conversationId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <div>
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={handleStart} disabled={isPending || !hasProfile} className="w-full">
        {isPending ? "セッション準備中..." : "Mairaに相談する"}
      </Button>
    </div>
  );
}

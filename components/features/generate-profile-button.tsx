"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  conversationId: string;
};

/**
 * 「結果を生成」ボタン
 *
 * 二段階確認(クリック→ダイアログ→生成)を採用しているのは、
 * API課金が発生する操作なので誤クリックを防ぐため。
 * 生成は generateObject なので 30秒〜1分のローディングが入る。
 */
export function GenerateProfileButton({ conversationId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleGenerate = () => {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/career/generate-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string; message?: string };
          throw new Error(data.message ?? data.error ?? "Generation failed");
        }

        router.push(`/app/career/${conversationId}/result`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  if (!showConfirm) {
    return (
      <Button variant="default" size="sm" onClick={() => setShowConfirm(true)}>
        結果を生成
      </Button>
    );
  }

  return (
    <div className="bg-card flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm">
        この会話から、キャリア棚卸し結果(強み・価値観・希望等)を生成します。
        生成には30秒〜1分かかります。
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>エラー: {error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleGenerate} disabled={isPending}>
          {isPending ? "生成中..." : "生成する"}
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
    </div>
  );
}

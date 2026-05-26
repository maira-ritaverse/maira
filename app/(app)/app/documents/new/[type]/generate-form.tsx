"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { documentTypeLabels, type DocumentType } from "@/lib/documents/types";

type Props = {
  documentType: DocumentType;
  requiresJobInfo: boolean;
};

/**
 * 書類生成フォーム(クライアントコンポーネント)
 *
 * useTransition でローディング状態を管理。
 * 書類生成は generateText を使うが 30秒〜1分かかるので、
 * ローディング表示は明示的に「時間がかかる」ことを伝える。
 */
export function DocumentGenerateForm({ documentType, requiresJobInfo }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobInfo, setJobInfo] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  const handleGenerate = () => {
    if (requiresJobInfo && !jobInfo.trim()) {
      setError("求人情報を入力してください");
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/documents/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: documentType,
            jobInfo: jobInfo.trim() || undefined,
            customInstructions: customInstructions.trim() || undefined,
          }),
        });

        if (!response.ok) {
          const data = (await response.json()) as {
            error?: string;
            message?: string;
          };
          throw new Error(data.message ?? data.error ?? "Generation failed");
        }

        const data = (await response.json()) as { conversationId: string };
        router.push(`/app/documents/${data.conversationId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="bg-muted rounded-lg p-4 text-sm">
          <p>
            <span className="font-medium">{documentTypeLabels[documentType]}</span>
            を、あなたのキャリア棚卸し結果に基づいて生成します。
          </p>
        </div>

        {requiresJobInfo && (
          <div className="space-y-2">
            <Label htmlFor="jobInfo">
              求人情報 <span className="text-red-600">*</span>
            </Label>
            <textarea
              id="jobInfo"
              value={jobInfo}
              onChange={(e) => setJobInfo(e.target.value)}
              placeholder="求人票を貼り付けてください(企業名、職種、業務内容、求める人物像など)"
              disabled={isPending}
              rows={10}
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-muted-foreground text-xs">
              求人情報が詳しいほど、書類の質が上がります
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="customInstructions">
            追加の指示 <span className="text-muted-foreground">(任意)</span>
          </Label>
          <textarea
            id="customInstructions"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="例:「もっと簡潔に」「ITスキルを強調して」など"
            disabled={isPending}
            rows={3}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>エラー: {error}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          📝 生成には30秒〜1分かかります。
        </div>

        <Button onClick={handleGenerate} disabled={isPending} className="w-full">
          {isPending ? "生成中(30秒〜1分)..." : "書類を生成する"}
        </Button>
      </div>
    </Card>
  );
}

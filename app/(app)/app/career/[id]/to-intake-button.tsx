"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  conversationId: string;
};

/**
 * キャリア棚卸し対話を AI ヒアリングと同じ抽出パイプラインにかけ、
 * 履歴書 / 職務経歴書の下書きを自動生成するためのボタン。
 *
 * 成功時:作成された intake recording の詳細ページへ遷移し、
 *   そこから「履歴書に反映」「職務経歴書に反映」できる。
 */
export function ToIntakeButton({ conversationId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (
      !confirm(
        "この会話の内容を AI で要約し、履歴書 / 職務経歴書の下書きを生成します。\nよろしいですか?",
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ recordingId: string }>(
        `/api/career/conversations/${conversationId}/to-intake`,
        { method: "POST" },
      );
      if (res?.recordingId) {
        router.push(`/app/career-intake/${res.recordingId}`);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={() => void submit()} disabled={submitting} variant="outline" size="sm">
        {submitting ? "生成中…" : "履歴書下書きを生成"}
      </Button>
      {error && (
        <p className="max-w-xs text-right text-xs text-red-600 dark:text-red-300">{error}</p>
      )}
    </div>
  );
}

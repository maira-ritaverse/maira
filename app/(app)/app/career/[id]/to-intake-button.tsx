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
 * 履歴書下書きを自動生成して 履歴書詳細ページへ 遷移するボタン。
 *
 * 旧設計では intake-recording の詳細ページに 飛ばしていたが、
 * 求職者向けの /app/career-intake/[id] は 廃止 → /app に redirect される
 * スタブになっているため、代わりに ここで 2 段階の API 呼び出しを 行い
 * 履歴書を 作成してから 直接 履歴書詳細ページへ 遷移する。
 *
 *   1. POST /api/career/conversations/[id]/to-intake
 *      → recording を 作成 + Claude 抽出 → recordingId を 返す
 *   2. POST /api/career-intake/recordings/[recordingId]/apply
 *      → 新規履歴書を 作成 → resumeId を 返す
 *   3. router.push(`/app/resumes/${resumeId}`)
 */
export function ToIntakeButton({ conversationId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (
      !confirm("この会話の内容を AI で要約し、履歴書の下書きを自動生成します。\nよろしいですか?")
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 1. キャリア対話 → extraction
      const intake = await apiFetch<{ recordingId: string }>(
        `/api/career/conversations/${conversationId}/to-intake`,
        { method: "POST" },
      );
      if (!intake?.recordingId) {
        throw new Error("下書き生成に失敗しました(recordingId が取得できませんでした)");
      }
      // 2. extraction → 新規履歴書 作成
      const apply = await apiFetch<{ resumeId: string }>(
        `/api/career-intake/recordings/${intake.recordingId}/apply`,
        {
          method: "POST",
          json: {
            // targetResumeId 無し = 新規作成、targetTitle で 履歴書名
            targetTitle: `キャリア棚卸しから生成 ${new Date().toLocaleDateString("ja-JP")}`,
          },
        },
      );
      if (!apply?.resumeId) {
        throw new Error("履歴書の作成に失敗しました(resumeId が取得できませんでした)");
      }
      // 3. 履歴書詳細ページへ
      router.push(`/app/resumes/${apply.resumeId}`);
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

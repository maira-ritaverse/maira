"use client";

/**
 * エージェント詳細画面の小さなボタン:
 * 「この面談録(録画)を求職者に確認依頼として送る」
 *
 * - 録画 ID は server コンポーネントから渡す(extracted 済 + meeting_schedule_id ありの 1 件目)
 * - クリックで POST /api/agency/meeting-shares → 成功で router.refresh()
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";

type Props = {
  recordingId: string;
  /** 既に共有済の録画(ボタンを disabled にして「共有済み」表示) */
  alreadyShared?: boolean;
};

export function RequestInterviewShareButton({ recordingId, alreadyShared }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadyShared ?? false);

  const send = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/agency/meeting-shares", {
        method: "POST",
        json: {
          recordingId,
          reviewMessage:
            "面談ありがとうございました。お話しいただいた内容を履歴書・職務経歴書のドラフトに反映してよいかご確認ください。",
        },
      });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return <span className="text-muted-foreground text-xs">求職者に確認依頼を送信済み</span>;
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={send} disabled={submitting}>
        {submitting ? "送信中…" : "求職者に確認依頼を送る"}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

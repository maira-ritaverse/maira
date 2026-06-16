"use client";

/**
 * 求職者向け:エージェント面談で抽出された職務経歴ドラフトの「承認/拒否」カード
 *
 * - エージェントからのメッセージを表示
 * - 「承認して履歴書に反映」「拒否」の 2 ボタン
 * - 承認すると status='accepted' になり、後続のマージ処理(Phase 5 後段)が発火する
 *
 * 暗号化された reviewMessage はサーバーで復号した状態で渡される前提。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, getErrorMessage } from "@/lib/api/client-fetch";
import type { InterviewShareView } from "@/lib/meetings/shares-queries";

type Props = {
  shares: InterviewShareView[];
};

function formatStart(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InterviewShareCard({ shares }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const respond = async (id: string, action: "accept" | "reject") => {
    setSubmitting(`${id}:${action}`);
    setError(null);
    try {
      await apiFetch(`/api/me/meeting-shares/${id}`, {
        method: "PATCH",
        json: { action },
      });
      router.refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  };

  if (shares.length === 0) return null;

  return (
    <Card className="border-primary/40 bg-primary/5 space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">エージェントからのキャリア棚卸し追加</h3>
        <span className="text-muted-foreground text-xs">{shares.length} 件</span>
      </div>

      <p className="text-muted-foreground text-xs">
        エージェントが面談記録から作成した内容を、あなたのキャリア棚卸しに反映してよいかご確認ください。
      </p>

      {error && (
        <div className="text-destructive border-destructive/40 bg-destructive/10 rounded border p-2 text-xs">
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {shares.map((s) => (
          <li key={s.id} className="bg-background space-y-2 rounded border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{s.meetingTitle}</div>
                <div className="text-muted-foreground text-xs">
                  {s.organizationName} ・ {s.hostDisplayName} ・ {formatStart(s.meetingStartsAt)}
                </div>
              </div>
            </div>
            {s.reviewMessage && (
              <p className="text-muted-foreground bg-muted/40 rounded px-2 py-1.5 text-xs whitespace-pre-wrap">
                {s.reviewMessage}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => respond(s.id, "reject")}
                disabled={submitting !== null}
              >
                {submitting === `${s.id}:reject` ? "送信中…" : "反映しない"}
              </Button>
              <Button
                size="sm"
                onClick={() => respond(s.id, "accept")}
                disabled={submitting !== null}
              >
                {submitting === `${s.id}:accept` ? "送信中…" : "棚卸しに反映する"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

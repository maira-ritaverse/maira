"use client";

import { useState } from "react";
import { usePopupChat } from "@/components/features/popup-chat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * 「Mairaに相談」ボタン
 *
 * Phase 3 以降:押下でポップアップチャットを開く。
 * セッションの取得・作成・履歴ロードは PopupChatWindow 側が担う(ボタンは起動するだけ)。
 *
 * career_profile が未生成のユーザーは AI 文脈が作れないため、
 * ここでブロックする(実態のチェックは API 側でも行う)。
 */

type Props = {
  applicationId: string;
  hasProfile: boolean;
};

export function AdvisorButton({ applicationId, hasProfile }: Props) {
  const { openForApplication } = usePopupChat();
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    if (!hasProfile) {
      setError("先にキャリア棚卸しを完了させてください");
      return;
    }
    setError(null);
    openForApplication(applicationId);
  };

  return (
    <div>
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={handleStart} disabled={!hasProfile} className="w-full">
        💬 Mairaに相談する
      </Button>
    </div>
  );
}

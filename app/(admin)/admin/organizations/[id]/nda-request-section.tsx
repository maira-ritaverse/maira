"use client";

/**
 * NDA 署名依頼セクション(運営者の組織詳細ページ用)。
 * 対象組織の管理者に「ログインして NDA に署名して」のリマインドメールを送る。
 */
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  organizationId: string;
  ndaAccepted: boolean;
  ndaSignerName: string | null;
};

export function NdaRequestSection({ organizationId, ndaAccepted, ndaSignerName }: Props) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    setMsg(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/organizations/${organizationId}/nda-request`, {
          method: "POST",
        });
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
          sentCount?: number;
          totalAdmins?: number;
        } | null;
        if (!res.ok) {
          setError(body?.message ?? body?.error ?? "送信に失敗しました");
          return;
        }
        setMsg(
          `署名依頼を ${body?.sentCount ?? 0}/${body?.totalAdmins ?? 0} 件の管理者に送信しました。`,
        );
      } catch {
        setError("送信に失敗しました");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">NDA(秘密保持契約)</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {ndaAccepted
            ? `同意済み(署名者: ${ndaSignerName ?? "—"})。`
            : "未同意です。管理者にログインして署名するようリマインドを送れます(自動ゲートが見えない等のフォールバック)。"}
        </p>
      </div>
      <div>
        <Button size="sm" variant="outline" disabled={isPending} onClick={send}>
          {isPending ? "送信中…" : "署名依頼メールを送る"}
        </Button>
      </div>
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

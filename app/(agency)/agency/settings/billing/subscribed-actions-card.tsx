"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { getErrorMessage } from "@/lib/api/client-fetch";

/**
 * 契約 中 プラン に 対して 実行 できる アクション を まとめる Client Card。
 *
 * ・Billing Portal ボタン → POST /api/agency/billing/portal-session → 遷移
 * ・解約 予約 中 でない → 「期末 で 解約」 ボタン (確認 ダイアログ 経由)
 * ・解約 予約 中 → 「解約 予約 を 取り 消す」 ボタン
 * ・past_due の 場合 は Portal で 支払 情報 更新 を 促す 案内
 *
 * 実 API 呼び出し は 全て bare fetch。 SDK は 使わ ない。
 */
type Props = {
  pendingCancel: boolean;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  currentPeriodEnd: string | null;
};

export function SubscribedActionsCard({ pendingCancel, status, currentPeriodEnd }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [reactivateLoading, setReactivateLoading] = useState(false);

  const openPortal = async () => {
    setPortalLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/billing/portal-session", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.url;
    } catch (e) {
      setError(getErrorMessage(e));
      setPortalLoading(false);
    }
  };

  const cancel = async () => {
    setError(null);
    const res = await fetch("/api/agency/billing/cancel", { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;
      throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
    }
    window.location.reload();
  };

  const reactivate = async () => {
    setReactivateLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agency/billing/reactivate", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (e) {
      setError(getErrorMessage(e));
      setReactivateLoading(false);
    }
  };

  const periodEndStr = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("ja-JP")
    : "現 期間 末";

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">プラン 管理</h2>

      {status === "past_due" && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription className="text-xs">
            直近 の 請求 で 支払 に 失敗 しました。 Billing Portal で カード 情報 を 更新 して
            ください。
          </AlertDescription>
        </Alert>
      )}

      {pendingCancel && (
        <Alert className="mt-3">
          <AlertDescription className="text-xs">
            {periodEndStr} で 解約 する 予約 が 入って います。 それ 以前 なら 「解約 予約 を 取り
            消す」 で 継続 でき ます。
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 space-y-3">
        <Button variant="outline" onClick={openPortal} disabled={portalLoading} className="w-full">
          {portalLoading ? "Portal 発行 中…" : "Billing Portal を 開く (カード 変更 / 領収書)"}
        </Button>

        {!pendingCancel && status !== "canceled" && (
          <ConfirmActionDialog
            trigger={
              <Button variant="outline" className="w-full">
                期末 で 解約 する
              </Button>
            }
            title="解約 予約 を 入れます"
            description={`${periodEndStr} で 契約 を 終了 します。 それ 以前 なら いつ でも 取り 消せ ます。`}
            confirmLabel="解約 予約 を 入れる"
            onConfirm={cancel}
          />
        )}

        {pendingCancel && (
          <Button onClick={reactivate} disabled={reactivateLoading} className="w-full">
            {reactivateLoading ? "取り 消し 中…" : "解約 予約 を 取り 消す"}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </Card>
  );
}

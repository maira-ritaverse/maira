"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DisclosureSummary } from "./disclosure-summary";

/**
 * 連携の各操作ボタン(承認・拒否・解除)
 *
 * すべて AlertDialog で意味と影響を明示してから Phase 2 の API を呼ぶ。
 * メール一致・状態遷移・本人確認はサーバー側の SECURITY DEFINER RPC で完結する
 * ため、本コンポーネントは「fetch して、成功で再描画 / 失敗でメッセージ」しか
 * 担当しない。
 *
 * 成功時の更新方針:
 *   router.refresh() で /app/connections の Server Component を再評価する。
 *   ページ全体の再フェッチで状態が反映されるため、Optimistic UI は持たない
 *   (誤って未確定の状態を見せると「解除した気になる」UX 事故が起きうるため)。
 */

type CommonResponse = { error?: string; message?: string };

async function postAction(clientRecordId: string, action: "accept" | "reject" | "revoke") {
  const response = await fetch(`/api/me/links/${clientRecordId}/${action}`, {
    method: "POST",
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as CommonResponse;
    throw new Error(json.message ?? json.error ?? "操作に失敗しました");
  }
}

// ====================================================================
// 承認(invited → linked)
// 開示範囲を明示する(DisclosureSummary を再利用)。
// ====================================================================
export function AcceptConnectionButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        await postAction(clientRecordId, "accept");
        router.refresh();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button size="sm" />}>承認する</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>この連携を承認しますか?</AlertDialogTitle>
          <AlertDialogDescription>
            承認すると、エージェントは以下の情報を閲覧できるようになります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DisclosureSummary />
        <p className="text-muted-foreground text-xs">
          連携はいつでも「連携を解除する」から取り消せます。
        </p>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? "承認中..." : "承認する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ====================================================================
// 拒否(invited → unlinked)
// 開示は一切始まらないことを説明。
// ====================================================================
export function RejectConnectionButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        await postAction(clientRecordId, "reject");
        router.refresh();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        拒否する
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>この招待を拒否しますか?</AlertDialogTitle>
          <AlertDialogDescription>
            拒否すると、このエージェントとの連携は始まりません。あなたの情報は引き続き
            非公開のままです。エージェントが再び招待してくれば、もう一度判断できます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "拒否中..." : "拒否する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ====================================================================
// 連携解除(linked → revoked)
// 解除後の影響(エージェントから情報が見えなくなる)を明示。
// ====================================================================
export function RevokeConnectionButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        await postAction(clientRecordId, "revoke");
        router.refresh();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        連携を解除する
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>連携を解除しますか?</AlertDialogTitle>
          <AlertDialogDescription>
            解除すると、このエージェントはあなたの履歴書・職務経歴書・希望条件・プロフィールを
            閲覧できなくなります。連携前に戻したい場合に使ってください。
            再度承認するには、エージェント側から招待を送り直してもらう必要があります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "解除中..." : "連携を解除する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

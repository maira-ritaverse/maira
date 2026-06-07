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

/**
 * エージェント側:クライアント詳細での連携アクション
 *
 * - InviteClientButton    :unlinked|revoked → invited(POST /invite)
 * - CancelInvitationButton:invited → unlinked(DELETE /invite)
 * - ApproveRevokeButton   :revoke_requested → revoked(POST /revoke-approve、P4)
 *
 * 認可・遷移検証は SECURITY DEFINER RPC で完結する。本コンポーネントは
 * 「fetch して、成功で router.refresh / 失敗でメッセージ」のみ担当。
 *
 * 招待は確認なしで実行できる軽い操作にし(求職者承認まで実害なし)、取消・承認は
 * 相手側に影響する破壊的操作なので AlertDialog で確認を取る。
 */

type CommonResponse = { error?: string; message?: string };

async function postInvite(clientRecordId: string) {
  const r = await fetch(`/api/agency/clients/${clientRecordId}/invite`, { method: "POST" });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as CommonResponse;
    throw new Error(j.message ?? j.error ?? "招待に失敗しました");
  }
}

async function deleteInvite(clientRecordId: string) {
  const r = await fetch(`/api/agency/clients/${clientRecordId}/invite`, { method: "DELETE" });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as CommonResponse;
    throw new Error(j.message ?? j.error ?? "取り消しに失敗しました");
  }
}

async function postApproveRevoke(clientRecordId: string) {
  const r = await fetch(`/api/agency/clients/${clientRecordId}/revoke-approve`, {
    method: "POST",
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as CommonResponse;
    throw new Error(j.message ?? j.error ?? "承認に失敗しました");
  }
}

// ====================================================================
// 招待を出す(unlinked|revoked → invited)
// ====================================================================
export function InviteClientButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await postInvite(clientRecordId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "招待中..." : "連携を招待する"}
      </Button>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ====================================================================
// 解除申請を承認(revoke_requested → revoked、P4)
//
// 即時に開示が停止する破壊的操作。承認しない場合は猶予期限の経過で自動的に
// revoked に確定する(P6 cron、未実装)が、エージェント承認は「早く確定する」
// 選択肢として提供される。拒否・差し戻し経路は方針として作らない(本人の
// 撤回権を守るため、エージェントは早く確定できるだけ)。
// ====================================================================
export function ApproveRevokeButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        await postApproveRevoke(clientRecordId);
        router.refresh();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button size="sm" />}>解除を承認する</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>解除申請を承認しますか?</AlertDialogTitle>
          <AlertDialogDescription>
            承認すると、このクライアントの履歴書・職務経歴書・希望条件の閲覧が
            <strong>即座に停止します</strong>
            。再連携には、改めて招待を送り直して求職者の承認を得る必要があります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-muted-foreground text-xs">
          承認しなくても、猶予期限の経過で自動的に停止します。今すぐ確定したい場合のみ承認してください。
        </p>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "承認中..." : "解除を承認する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ====================================================================
// 招待を取り消す(invited → unlinked)
// ====================================================================
export function CancelInvitationButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteInvite(clientRecordId);
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
        招待を取り消す
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>招待を取り消しますか?</AlertDialogTitle>
          <AlertDialogDescription>
            このクライアントへの連携招待を取り消します。求職者側で承認待ち状態が解除されます。
            必要なら再度招待を出すことができます。
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
            {isPending ? "取消中..." : "取り消す"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

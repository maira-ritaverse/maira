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
 * - InviteClientButton:unlinked|revoked → invited(POST /invite)
 * - CancelInvitationButton:invited → unlinked(DELETE /invite)
 *
 * 認可・遷移検証は Phase 2 の SECURITY DEFINER RPC で完結する。本コンポーネントは
 * 「fetch して、成功で router.refresh / 失敗でメッセージ」のみ担当。
 *
 * 招待は確認なしで実行できる軽い操作にし(求職者承認まで実害なし)、取消は
 * 「相手がすでに承認に向かっているかもしれない」可能性があるので AlertDialog で
 * 確認を取る。
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

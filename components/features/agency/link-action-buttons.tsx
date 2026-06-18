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
 * - InviteClientButton    :unlinked|revoked → invited
 *                          POST /api/agency/clients/[id]/invite
 *                          (RPC でトークン発行 + Resend メール送信)
 * - ResendInvitationButton:invited のまま 新トークン発行 + メール再送
 *                          POST /api/agency/clients/[id]/invite と同じエンドポイント
 *                          (RPC が link_status='invited' でも 5 分クールダウンで受け付ける)
 * - CancelInvitationButton:invited → unlinked(DELETE /invite)
 * - ApproveRevokeButton   :revoke_requested → revoked(POST /revoke-approve、P4)
 *
 * 認可・遷移検証は SECURITY DEFINER RPC で完結する。本コンポーネントは
 * 「fetch して、成功で router.refresh / 失敗でメッセージ」のみ担当。
 */

type CommonResponse = {
  error?: string;
  message?: string;
  emailStatus?: { sent: true } | { sent: false; reason: string };
  inviteUrl?: string;
};

type IssueInvitationResponse = CommonResponse;

async function postInvite(clientRecordId: string): Promise<IssueInvitationResponse> {
  const r = await fetch(`/api/agency/clients/${clientRecordId}/invite`, { method: "POST" });
  const json = (await r.json().catch(() => ({}))) as IssueInvitationResponse;
  if (!r.ok) {
    throw new Error(json.message ?? json.error ?? "招待に失敗しました");
  }
  return json;
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

function feedbackFromResponse(res: IssueInvitationResponse, defaultSuccess: string): string {
  if (res.emailStatus?.sent) return defaultSuccess;
  if (res.emailStatus && !res.emailStatus.sent) {
    if (res.emailStatus.reason === "not_configured") {
      return "招待は発行されました(メール送信は未設定のためスキップ)";
    }
    return "招待は発行されましたが、メール送信に失敗しました。少し時間をおいて再送してください。";
  }
  return defaultSuccess;
}

// ====================================================================
// 招待を出す(unlinked|revoked → invited)
// ====================================================================
export function InviteClientButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await postInvite(clientRecordId);
        setSuccess(feedbackFromResponse(res, "招待メールを送信しました"));
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
      {success && (
        <p className="text-sm text-emerald-700" role="status">
          {success}
        </p>
      )}
    </div>
  );
}

// ====================================================================
// 招待メールを再送する(invited → invited、新トークン発行 + メール再送)
//
// 5 分以内の再送は RPC 側でクールダウン拒否される(HTTP 429)。
// UX としては「押せるが押すと 429 で怒られる」より「ボタン押下時に拒否表示」だけで十分。
// ====================================================================
export function ResendInvitationButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await postInvite(clientRecordId);
        setSuccess(feedbackFromResponse(res, "招待メールを再送しました"));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={handleClick} disabled={isPending}>
        {isPending ? "再送中..." : "招待メールを再送する"}
      </Button>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700" role="status">
          {success}
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

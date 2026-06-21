"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { DisclosureSummary } from "./disclosure-summary";

/**
 * 連携の各操作ボタン(承認・拒否・解除)
 *
 * すべて ConfirmActionDialog で意味と影響を明示してから Phase 2 の API を呼ぶ。
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
  return (
    <ConfirmActionDialog
      trigger={<Button size="sm">承認する</Button>}
      title="この連携を承認しますか?"
      description={
        <>
          承認すると、エージェントは以下の情報を閲覧できるようになります。
          <DisclosureSummary />
          <span className="text-muted-foreground mt-2 block text-xs">
            連携はいつでも「連携を解除する」から取り消せます。
          </span>
        </>
      }
      confirmLabel="承認する"
      pendingLabel="承認中..."
      onConfirm={async () => {
        await postAction(clientRecordId, "accept");
        router.refresh();
      }}
    />
  );
}

// ====================================================================
// 拒否(invited → unlinked)
// 開示は一切始まらないことを説明。
// ====================================================================
export function RejectConnectionButton({ clientRecordId }: { clientRecordId: string }) {
  const router = useRouter();
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          拒否する
        </Button>
      }
      title="この招待を拒否しますか?"
      description="拒否すると、このエージェントとの連携は始まりません。あなたの情報は引き続き非公開のままです。エージェントが再び招待してくれば、もう一度判断できます。"
      confirmLabel="拒否する"
      pendingLabel="拒否中..."
      destructive
      onConfirm={async () => {
        await postAction(clientRecordId, "reject");
        router.refresh();
      }}
    />
  );
}

// ====================================================================
// 連携解除の申請(linked → revoke_requested)
//
// P3 で挙動が「即時解除」→「申請」に変わった。
// ダイアログでは「即時には止まらない/必ずいつかは止まる」の両方を明示する:
//   - 申請後も猶予期間内は引き続き開示される(突然遮断しない=エージェント側の
//     業務が中途半端な状態で切れる事故を防ぐ)
//   - エージェントの承認、または猶予期間の経過で必ず止まる(撤回権の安全弁、
//     P6 で 自動 revoked cron が 動く)
//
// graceDays は organizations.revoke_grace_days を本人側から引いたもの
// (lib/connections/queries.ts 参照)。RLS で取れない/未設定なら null になり
// 「組織が設定した猶予期間」とのフォールバック文言に倒す。
// ====================================================================
export function RevokeConnectionButton({
  clientRecordId,
  graceDays,
}: {
  clientRecordId: string;
  graceDays: number | null;
}) {
  const router = useRouter();
  const graceLabel = graceDays != null ? `最大 ${graceDays} 日` : "組織が設定した猶予期間";

  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" size="sm">
          解除を申請する
        </Button>
      }
      title="連携の解除を申請しますか?"
      description={
        <>
          このエージェントに「連携を解除してください」と申請します。申請は即時には反映されず、
          エージェントの承認、または猶予期間({graceLabel})の経過で必ず停止します。
          <span className="text-muted-foreground mt-2 block space-y-2 text-xs">
            <span className="block">
              <strong className="text-foreground">申請後も、停止までの間は</strong>
              、履歴書・職務経歴書・希望条件は引き続きエージェントに開示されます。
              選考が進行中の場合に「承認前に突然見えなくなる」事故を避けるためです。
            </span>
            <span className="mt-2 block">
              <strong className="text-foreground">停止後</strong>
              、エージェントからは履歴書・職務経歴書・希望条件・プロフィールが閲覧できなくなります。
              再連携するには、エージェント側から招待を送り直してもらう必要があります。
            </span>
            <span className="mt-2 block">
              申請の取り下げは現在できません。慎重にご判断ください。
            </span>
          </span>
        </>
      }
      confirmLabel="解除を申請する"
      pendingLabel="申請中..."
      destructive
      onConfirm={async () => {
        await postAction(clientRecordId, "revoke");
        router.refresh();
      }}
    />
  );
}

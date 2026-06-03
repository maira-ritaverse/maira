"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitation, type AcceptInvitationResult } from "./actions";

type Props = {
  token: string;
  /**
   * 受諾成功後に遷移する URL。組織メンバー側のホーム(/agency/clients)を既定にする。
   * /agency/* は AgencyLayout のロールガードがあるので、念のためそこを起点に。
   */
  redirectTo?: string;
};

/**
 * 受諾ボタン
 *
 * accept_invitation Server Action を呼ぶだけのシンプルな Client Component。
 * - 成功:redirectTo に router.push
 * - 失敗:エラーメッセージをインライン表示(再試行可能)
 *
 * email_mismatch 等の検証失敗は着地ページ側(Server Component)でも先回りで
 * 弾いているが、競合(別タブで先に受諾された等)で RPC 段階でしか分からない
 * ケースもあるため、ここでも 4 種類のエラーを正しく表示する。
 */
export function AcceptInvitationButton({ token, redirectTo = "/agency/clients" }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AcceptInvitationResult | null>(null);

  const handleAccept = async () => {
    setSubmitting(true);
    setResult(null);

    try {
      const res = await acceptInvitation(token);
      if (res.ok) {
        // ロール変更後のレイアウト再評価のため、router.refresh ではなく
        // push + refresh を組み合わせる(layout cache は revalidatePath で破棄済み)。
        router.push(redirectTo);
        router.refresh();
        return;
      }
      setResult(res);
    } catch (err) {
      setResult({
        ok: false,
        code: "unknown",
        message: err instanceof Error ? err.message : "通信エラーが発生しました",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button type="button" onClick={handleAccept} disabled={submitting} className="w-full">
        {submitting ? "参加処理中…" : "参加する"}
      </Button>
      {result && !result.ok && (
        <Alert variant="destructive">
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

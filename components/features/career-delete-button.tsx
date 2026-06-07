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
 * 「棚卸し結果を削除する」ボタン(影響説明ダイアログつき)
 *
 * Phase C。career_profile を持つユーザー向け、結果ページに集約して置く
 * (一覧カードには置かず、誤操作を防ぐ)。
 *
 * 影響:
 * - 削除すると同じ行内の diagnosis(キャリア診断結果)も同時に消える。
 * - 履歴書・職務経歴書・作成済み書類は独立テーブルのため残るが、AI 下書きや
 *   「Mairaに相談」は棚卸しが無いと使えなくなる。
 *
 * 設計:
 * - DELETE /api/career/profile を呼ぶ。認可はサーバ側 + RLS で本人限定。
 *   本コンポーネントから user_id は送らない(サーバ側 auth.getUser() で決まる)。
 * - 成功で /app/career(一覧)に遷移。一覧は profile なし状態(empty)に戻り、
 *   初回導線「新しく棚卸しを始める」が再表示される。
 */
export function CareerDeleteButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/career/profile", { method: "DELETE" });
        if (!response.ok) {
          const json = (await response.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(json.message ?? json.error ?? "削除に失敗しました");
        }
        // 削除成功 → 一覧へ。router.refresh で Server Component の getCareerProfile を再評価。
        router.push("/app/career");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "通信エラーが発生しました");
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
        削除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>棚卸し結果を削除しますか?</AlertDialogTitle>
          <AlertDialogDescription>
            削除すると、棚卸し結果に加えてキャリア診断の結果も同時に消えます。
            履歴書・職務経歴書・作成済みの書類は残りますが、AI
            による下書き生成と「Mairaに相談」は、棚卸しをやり直すまで使えなくなります。
            この操作は元に戻せません。
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
            {isPending ? "削除中..." : "削除する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

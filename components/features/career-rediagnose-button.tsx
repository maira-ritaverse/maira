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
 * 「もう一度棚卸しする」ボタン(上書き警告つき)
 *
 * career_profile が既に存在するユーザー向けに、新規会話セッション開始を
 * 警告ダイアログ経由で行わせる UI のみのコンポーネント。
 *
 * - 確認 OK で /app/career/new に遷移する(新規会話セッションの作成は
 *   既存の Server Page 側で行う。本コンポーネントは遷移のみを担う)。
 * - 実際の「上書き」は新しい会話で generate-profile が呼ばれた時に起きる。
 *   ボタン押下や新セッション作成だけでは career_profile は変わらない。
 *   ただし「再診断意図のスタート地点」で警告を出す方針(本 Phase の趣旨)。
 *
 * 設置場所:
 * - app/(app)/app/career/[id]/result/page.tsx(結果ページ)
 * - app/(app)/app/career/page.tsx(一覧の「現在の棚卸し結果」サマリーカード)
 */

type Props = {
  label?: string;
  size?: "default" | "sm" | "xs" | "lg";
  variant?: "default" | "outline" | "secondary" | "ghost";
};

export function CareerRediagnoseButton({
  label = "もう一度棚卸しする",
  size = "sm",
  variant = "outline",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    // 遷移完了まで保留中表示にしたいので transition で包む。
    // /app/career/new は Server Component で createCareerConversation → redirect する。
    startTransition(() => {
      router.push("/app/career/new");
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} size={size} />}>
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>もう一度棚卸しをしますか?</AlertDialogTitle>
          <AlertDialogDescription>
            現在の棚卸し結果は、新しい内容で上書きされます。よろしいですか?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? "開始中..." : "棚卸しを始める"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

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

  return (
    <ConfirmActionDialog
      trigger={
        <Button variant={variant} size={size}>
          {label}
        </Button>
      }
      title="もう一度棚卸しをしますか?"
      description="現在の棚卸し結果は、新しい内容で上書きされます。よろしいですか?"
      confirmLabel="棚卸しを始める"
      pendingLabel="開始中..."
      onConfirm={() => {
        // /app/career/new は Server Component で createCareerConversation → redirect する。
        router.push("/app/career/new");
      }}
    />
  );
}
